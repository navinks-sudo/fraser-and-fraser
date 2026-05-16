"""End-to-end batch pipeline + GEDCOM export.

Endpoints:
  POST /projects/{p}/batches/{b}/process       — run OCR → extract → tree for every image
  GET  /projects/{p}/batches/{b}/process/status — poll progress
  GET  /projects/{p}/batches/{b}/export.ged    — download GEDCOM 5.5
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from backend.core.dependencies import get_current_user
from backend.database import get_db, async_session_maker
from backend.models import Batch, Image, OCRText, Record, Project, GedcomXRecord
from backend.services.ai_service import ai_service
from backend.services.gedcom_export import gedcomx_to_gedcom
from backend.services.indexgenius_service import IndexGeniusService
from backend.services.textiq_service import TextIQService
from backend.services.gedcomx_service import _dedupe_persons

log = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/batches/{batch_id}", tags=["pipeline"])

# In-memory job tracker (per-process).  For prod this would be Redis / DB-backed.
JOBS: dict[str, dict] = {}


def _job_init(job_id: str, batch_id: int, total: int):
    JOBS[job_id] = {
        "id": job_id,
        "batch_id": batch_id,
        "started_at": datetime.utcnow().isoformat(),
        "completed_at": None,
        "total": total,
        "done": 0,
        "current_image_id": None,
        "current_stage": None,
        "errors": [],
        "status": "running",   # "running" | "complete" | "error"
    }


def _job_update(job_id: str, **fields):
    if job_id in JOBS:
        JOBS[job_id].update(fields)


async def _run_pipeline(job_id: str, batch_id: int):
    """Execute OCR → IndexGenius for every image, then BuildTree for the batch."""
    textiq = TextIQService()
    indexgenius = IndexGeniusService()

    try:
        async with async_session_maker() as db:
            res = await db.execute(select(Image).where(Image.batch_id == batch_id).order_by(Image.sort_order))
            images = res.scalars().all()
            JOBS[job_id]["total"] = len(images) + 1  # +1 for build_family_tree

            for img in images:
                JOBS[job_id]["current_image_id"] = img.id

                # ── Stage 1: OCR (skip for spreadsheets)
                if img.file_type != "spreadsheet":
                    JOBS[job_id]["current_stage"] = "ocr"
                    try:
                        source_path = img.enhanced_path or img.original_path
                        data = await textiq.perform_ocr(source_path)
                        text = data.get("text", "")
                        # upsert OCRText
                        res = await db.execute(select(OCRText).where(OCRText.image_id == img.id))
                        db_ocr = res.scalars().first()
                        page_region = {
                            "index": 0, "bbox": None, "summary": "Whole page", "language": None,
                            "text": text, "words": data.get("words") or [], "chars": data.get("chars") or [],
                            "avg_confidence": data.get("avg_confidence"),
                            "low_confidence_count": data.get("low_confidence_count"),
                            "confidence_source": data.get("confidence_source"),
                        }
                        if db_ocr:
                            db_ocr.current_text = text
                            if not db_ocr.original_text:
                                db_ocr.original_text = text
                            db_ocr.regions = json.dumps([page_region], ensure_ascii=False)
                        else:
                            db.add(OCRText(
                                image_id=img.id, current_text=text, original_text=text,
                                regions=json.dumps([page_region], ensure_ascii=False),
                            ))
                        img.textiq_status = "done"
                        await db.commit()
                    except Exception as e:
                        log.exception("OCR failed for image %s", img.id)
                        JOBS[job_id]["errors"].append({"image_id": img.id, "stage": "ocr", "error": str(e)[:200]})
                        img.textiq_status = "error"
                        await db.commit()
                        JOBS[job_id]["done"] += 1
                        continue

                # ── Stage 2: IndexGenius extraction
                JOBS[job_id]["current_stage"] = "extract"
                try:
                    if img.file_type == "spreadsheet":
                        ss = json.loads(img.spreadsheet_data) if img.spreadsheet_data else {"sheets": []}
                        raw = await ai_service.extract_from_spreadsheet(ss.get("sheets") or [])
                        from backend.routers.indexgenius import _build_extraction_from_spreadsheet
                        extraction = _build_extraction_from_spreadsheet(raw)
                    else:
                        res = await db.execute(select(OCRText).where(OCRText.image_id == img.id))
                        ocr = res.scalars().first()
                        if not ocr or not ocr.current_text:
                            JOBS[job_id]["done"] += 1
                            continue
                        # Multimodal extraction — pass the original image alongside OCR
                        extraction = await indexgenius.extract_record(
                            ocr.current_text,
                            image_path=(img.enhanced_path or img.original_path),
                        )

                    res = await db.execute(select(Record).where(Record.image_id == img.id))
                    db_record = res.scalars().first()
                    record_data = {
                        "record_number": extraction.record_number,
                        "event_type": extraction.event_type,
                        "given_name": extraction.given_name,
                        "surname": extraction.surname,
                        "date_of_birth": extraction.date_of_birth,
                        "date_of_death": extraction.date_of_death,
                        "date_of_event": extraction.date_of_event,
                        "place_of_event": extraction.place_of_event,
                        "father_name": extraction.father_name,
                        "mother_name": extraction.mother_name,
                        "family_members": json.dumps([m.dict() for m in extraction.family_members]),
                        "persons_extracted": json.dumps([p.dict() for p in extraction.persons]),
                        "relations_extracted": json.dumps([r.dict() for r in extraction.relations]),
                        "metadata_extracted": json.dumps([m.dict() for m in extraction.metadata]),
                        "field_confidences": json.dumps(extraction.field_confidences),
                        "additional_info": json.dumps(extraction.additional_info),
                        "raw_extracted": json.dumps(extraction.dict()),
                    }
                    if db_record:
                        for k, v in record_data.items():
                            setattr(db_record, k, v)
                    else:
                        db.add(Record(image_id=img.id, **record_data))
                    img.indexgenius_status = "done"
                    await db.commit()
                except Exception as e:
                    log.exception("Extract failed for image %s", img.id)
                    JOBS[job_id]["errors"].append({"image_id": img.id, "stage": "extract", "error": str(e)[:200]})
                    img.indexgenius_status = "error"
                    await db.commit()

                JOBS[job_id]["done"] += 1

            # ── Stage 3: Build whole-batch family tree
            JOBS[job_id]["current_image_id"] = None
            JOBS[job_id]["current_stage"] = "build_tree"
            try:
                res = await db.execute(
                    select(Record, Image).join(Image, Record.image_id == Image.id).where(Image.batch_id == batch_id)
                )
                records_payload = []
                for record, image in res.all():
                    records_payload.append({
                        "image_id": record.image_id,
                        "given_name": record.given_name,
                        "surname": record.surname,
                        "event_type": record.event_type,
                        "date_of_birth": record.date_of_birth,
                        "date_of_death": record.date_of_death,
                        "date_of_event": record.date_of_event,
                        "father_name": record.father_name,
                        "mother_name": record.mother_name,
                        "family_members": json.loads(record.family_members) if record.family_members else [],
                    })
                if records_payload:
                    tree = await ai_service.build_family_tree(records_payload)
                    res = await db.execute(select(Batch).where(Batch.id == batch_id))
                    batch = res.scalars().first()
                    if batch:
                        batch.tree_data = json.dumps(tree, ensure_ascii=False)
                        batch.tree_persons_count = len(tree.get("persons") or [])
                        batch.tree_relationships_count = len(tree.get("relationships") or [])
                        batch.tree_built_at = datetime.utcnow()
                        await db.commit()
            except Exception as e:
                log.exception("Build tree failed")
                JOBS[job_id]["errors"].append({"stage": "build_tree", "error": str(e)[:200]})

            JOBS[job_id]["done"] += 1
            JOBS[job_id]["completed_at"] = datetime.utcnow().isoformat()
            JOBS[job_id]["status"] = "complete" if not JOBS[job_id]["errors"] else "complete_with_errors"
            JOBS[job_id]["current_stage"] = None
    except Exception as e:
        log.exception("Pipeline crashed")
        JOBS[job_id]["status"] = "error"
        JOBS[job_id]["errors"].append({"stage": "pipeline", "error": str(e)[:200]})
        JOBS[job_id]["completed_at"] = datetime.utcnow().isoformat()


# ── current job id per batch
BATCH_JOB: dict[int, str] = {}


@router.post("/process")
async def process_batch(
    project_id: int,
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Run the full pipeline on every image in the batch (OCR → extract → tree)."""
    res = await db.execute(select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id)))
    batch = res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    res = await db.execute(select(Image).where(Image.batch_id == batch_id))
    images = res.scalars().all()
    if not images:
        raise HTTPException(status_code=400, detail="No images in this batch")

    # Check whether a job is already running
    prev = BATCH_JOB.get(batch_id)
    if prev and JOBS.get(prev, {}).get("status") == "running":
        return {"job_id": prev, "started": False, "message": "A pipeline is already running for this batch."}

    job_id = str(uuid.uuid4())
    BATCH_JOB[batch_id] = job_id
    _job_init(job_id, batch_id, len(images) + 1)
    asyncio.create_task(_run_pipeline(job_id, batch_id))
    return {"job_id": job_id, "started": True, "total_steps": len(images) + 1}


@router.post("/reset-and-process")
async def reset_and_process(
    project_id: int,
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Destructive: wipe every derived artifact (OCR, records, GedcomX, tree)
    for this batch, reset all image stage statuses, then re-run the full
    pipeline from scratch.

    The uploaded image files on disk are NOT touched — only the AI-derived data.
    """
    res = await db.execute(select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id)))
    batch = res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    res = await db.execute(select(Image).where(Image.batch_id == batch_id))
    images = res.scalars().all()
    if not images:
        raise HTTPException(status_code=400, detail="No images in this batch")

    # Refuse to start if a pipeline is already running for this batch
    prev = BATCH_JOB.get(batch_id)
    if prev and JOBS.get(prev, {}).get("status") == "running":
        return {"job_id": prev, "started": False, "message": "A pipeline is already running for this batch."}

    image_ids = [img.id for img in images]

    # Gather record ids first so we can cascade-delete GedcomX rows
    res = await db.execute(select(Record.id).where(Record.image_id.in_(image_ids)))
    record_ids = [rid for (rid,) in res.all()]

    # ── Wipe derived state ──
    deleted = {"ocr": 0, "records": 0, "gedcomx": 0}

    if record_ids:
        res = await db.execute(select(GedcomXRecord).where(GedcomXRecord.record_id.in_(record_ids)))
        for gx in res.scalars().all():
            await db.delete(gx)
            deleted["gedcomx"] += 1

    res = await db.execute(select(Record).where(Record.image_id.in_(image_ids)))
    for rec in res.scalars().all():
        await db.delete(rec)
        deleted["records"] += 1

    res = await db.execute(select(OCRText).where(OCRText.image_id.in_(image_ids)))
    for ocr in res.scalars().all():
        await db.delete(ocr)
        deleted["ocr"] += 1

    # ── Reset image stage statuses ──
    for img in images:
        img.textiq_status = "pending"
        img.indexgenius_status = "pending"
        img.gedcomx_status = "pending"
        if hasattr(img, "segment_status"):
            img.segment_status = "pending"
        if hasattr(img, "visionmax_status"):
            img.visionmax_status = "pending"
        if hasattr(img, "region_data"):
            img.region_data = None

    # ── Reset batch tree state ──
    batch.tree_data = None
    batch.tree_built_at = None
    batch.tree_persons_count = 0
    batch.tree_relationships_count = 0

    await db.commit()
    log.info(
        "[reset] batch %s wiped: %d OCR rows, %d records, %d gedcomx rows; %d images reset",
        batch_id, deleted["ocr"], deleted["records"], deleted["gedcomx"], len(images),
    )

    # ── Kick off a fresh pipeline ──
    job_id = str(uuid.uuid4())
    BATCH_JOB[batch_id] = job_id
    _job_init(job_id, batch_id, len(images) + 1)
    asyncio.create_task(_run_pipeline(job_id, batch_id))
    return {
        "job_id": job_id,
        "started": True,
        "total_steps": len(images) + 1,
        "wiped": deleted,
        "images_reset": len(images),
    }


@router.get("/process/status")
async def process_status(
    project_id: int,
    batch_id: int,
    current_user: dict = Depends(get_current_user),
):
    job_id = BATCH_JOB.get(batch_id)
    if not job_id or job_id not in JOBS:
        return {"status": "idle"}
    return JOBS[job_id]


# ─── Retry-only pipeline for images whose extraction failed or came back empty ──
async def _run_retry_empty(job_id: str, batch_id: int, image_ids: list[int]):
    """Re-run ONLY extract + tree-build for the given image IDs.

    OCR is preserved (we don't re-OCR). Useful after a prompt fix: replays
    extraction against the existing OCR text for every image whose previous
    extraction returned zero persons or errored out.
    """
    indexgenius = IndexGeniusService()
    try:
        async with async_session_maker() as db:
            for image_id in image_ids:
                JOBS[job_id]["current_image_id"] = image_id
                JOBS[job_id]["current_stage"] = "re-extract"

                res = await db.execute(select(Image).where(Image.id == image_id))
                img = res.scalars().first()
                if not img:
                    JOBS[job_id]["done"] += 1
                    continue

                try:
                    if img.file_type == "spreadsheet":
                        ss = json.loads(img.spreadsheet_data) if img.spreadsheet_data else {"sheets": []}
                        raw = await ai_service.extract_from_spreadsheet(ss.get("sheets") or [])
                        from backend.routers.indexgenius import _build_extraction_from_spreadsheet
                        extraction = _build_extraction_from_spreadsheet(raw)
                    else:
                        res = await db.execute(select(OCRText).where(OCRText.image_id == image_id))
                        ocr = res.scalars().first()
                        if not ocr or not ocr.current_text:
                            JOBS[job_id]["errors"].append({
                                "image_id": image_id, "stage": "re-extract",
                                "error": "no OCR text — run OCR first",
                            })
                            JOBS[job_id]["done"] += 1
                            continue
                        # Multimodal — pass image alongside the OCR text
                        extraction = await indexgenius.extract_record(
                            ocr.current_text,
                            image_path=(img.enhanced_path or img.original_path),
                        )

                    res = await db.execute(select(Record).where(Record.image_id == image_id))
                    db_record = res.scalars().first()
                    record_data = {
                        "record_number": extraction.record_number,
                        "event_type": extraction.event_type,
                        "given_name": extraction.given_name,
                        "surname": extraction.surname,
                        "date_of_birth": extraction.date_of_birth,
                        "date_of_death": extraction.date_of_death,
                        "date_of_event": extraction.date_of_event,
                        "place_of_event": extraction.place_of_event,
                        "father_name": extraction.father_name,
                        "mother_name": extraction.mother_name,
                        "family_members": json.dumps([m.dict() for m in extraction.family_members]),
                        "persons_extracted": json.dumps([p.dict() for p in extraction.persons]),
                        "relations_extracted": json.dumps([r.dict() for r in extraction.relations]),
                        "metadata_extracted": json.dumps([m.dict() for m in extraction.metadata]),
                        "field_confidences": json.dumps(extraction.field_confidences),
                        "additional_info": json.dumps(extraction.additional_info),
                        "raw_extracted": json.dumps(extraction.dict()),
                    }
                    if db_record:
                        for k, v in record_data.items():
                            setattr(db_record, k, v)
                    else:
                        db.add(Record(image_id=image_id, **record_data))
                    img.indexgenius_status = "done"
                    await db.commit()
                except Exception as e:
                    log.exception("Retry-extract failed for image %s", image_id)
                    JOBS[job_id]["errors"].append({"image_id": image_id, "stage": "re-extract", "error": str(e)[:200]})
                    img.indexgenius_status = "error"
                    await db.commit()

                JOBS[job_id]["done"] += 1

            # Rebuild the batch tree to incorporate the newly-extracted persons
            JOBS[job_id]["current_image_id"] = None
            JOBS[job_id]["current_stage"] = "build_tree"
            try:
                res = await db.execute(
                    select(Record, Image).join(Image, Record.image_id == Image.id).where(Image.batch_id == batch_id)
                )
                records_payload = []
                for record, image in res.all():
                    records_payload.append({
                        "image_id": record.image_id,
                        "given_name": record.given_name,
                        "surname": record.surname,
                        "event_type": record.event_type,
                        "date_of_birth": record.date_of_birth,
                        "date_of_death": record.date_of_death,
                        "date_of_event": record.date_of_event,
                        "father_name": record.father_name,
                        "mother_name": record.mother_name,
                        "family_members": json.loads(record.family_members) if record.family_members else [],
                    })
                if records_payload:
                    tree = await ai_service.build_family_tree(records_payload)
                    res = await db.execute(select(Batch).where(Batch.id == batch_id))
                    batch = res.scalars().first()
                    if batch:
                        batch.tree_data = json.dumps(tree, ensure_ascii=False)
                        batch.tree_persons_count = len(tree.get("persons") or [])
                        batch.tree_relationships_count = len(tree.get("relationships") or [])
                        batch.tree_built_at = datetime.utcnow()
                        await db.commit()
            except Exception as e:
                log.exception("Retry tree build failed")
                JOBS[job_id]["errors"].append({"stage": "build_tree", "error": str(e)[:200]})

            JOBS[job_id]["done"] += 1
            JOBS[job_id]["completed_at"] = datetime.utcnow().isoformat()
            JOBS[job_id]["status"] = "complete" if not JOBS[job_id]["errors"] else "complete_with_errors"
            JOBS[job_id]["current_stage"] = None
    except Exception as e:
        log.exception("Retry pipeline crashed")
        JOBS[job_id]["status"] = "error"
        JOBS[job_id]["errors"].append({"stage": "pipeline", "error": str(e)[:200]})
        JOBS[job_id]["completed_at"] = datetime.utcnow().isoformat()


@router.post("/retry-empty")
async def retry_empty_extractions(
    project_id: int,
    batch_id: int,
    scope: str = "incomplete",   # 'incomplete' | 'all'
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Re-run extraction on a subset (or all) of the batch's images.

    scope=incomplete (default): targets every image whose extraction either
      errored, has no record yet, has zero persons, OR has ≥2 persons but
      zero relations. This catches the silent-no-relations failure mode.

    scope=all: forces a fresh extraction on every image in the batch
      regardless of current state. Useful after a prompt upgrade.

    Either way, OCR is preserved — only the extract step re-runs.
    """
    res = await db.execute(select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id)))
    batch = res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Pull images + their records to identify which need re-extracting
    res = await db.execute(
        select(Image, Record).join(Record, Record.image_id == Image.id, isouter=True)
                            .where(Image.batch_id == batch_id)
                            .order_by(Image.sort_order)
    )
    targets: list[int] = []
    for img, record in res.all():
        # Skip images without OCR — can't extract from nothing
        if img.file_type != "spreadsheet" and img.textiq_status != "done":
            continue

        if scope == "all":
            targets.append(img.id)
            continue

        # scope == "incomplete"
        if img.indexgenius_status == "error":
            targets.append(img.id)
            continue
        if record is None:
            targets.append(img.id)
            continue
        try:
            persons = json.loads(record.persons_extracted or "[]")
        except (json.JSONDecodeError, TypeError):
            persons = []
        try:
            relations = json.loads(record.relations_extracted or "[]")
        except (json.JSONDecodeError, TypeError):
            relations = []
        # No persons → empty extraction → retry
        if not persons:
            targets.append(img.id)
            continue
        # 2+ persons but no relations → tree-incomplete → retry
        if isinstance(persons, list) and len(persons) >= 2:
            if not isinstance(relations, list) or len(relations) == 0:
                targets.append(img.id)
                continue

    if not targets:
        return {
            "started": False,
            "total": 0,
            "message": "All images already have complete extractions (persons + relations) — nothing to retry.",
        }

    # Check whether a job is already running
    prev = BATCH_JOB.get(batch_id)
    if prev and JOBS.get(prev, {}).get("status") == "running":
        return {"job_id": prev, "started": False, "message": "A pipeline is already running for this batch."}

    job_id = str(uuid.uuid4())
    BATCH_JOB[batch_id] = job_id
    _job_init(job_id, batch_id, len(targets) + 1)
    asyncio.create_task(_run_retry_empty(job_id, batch_id, targets))
    return {"job_id": job_id, "started": True, "total_steps": len(targets) + 1, "image_ids": targets, "scope": scope}


@router.get("/export.ged")
async def export_gedcom(
    project_id: int,
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Download the batch's family tree as a GEDCOM 5.5 file (.ged)."""
    res = await db.execute(select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id)))
    batch = res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if not batch.tree_data:
        raise HTTPException(status_code=400, detail="No tree built yet. Click 'Build with AI' first.")
    try:
        gedcomx = json.loads(batch.tree_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Stored tree data is corrupted.")
    text = gedcomx_to_gedcom(gedcomx, submitter=f"GenealogIQ batch {batch.name}")
    filename = f"{batch.name.replace(' ', '_')}.ged"
    return Response(
        content=text,
        media_type="text/x-gedcom",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export.json")
async def export_gedcomx_json(
    project_id: int,
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Download the batch's family tree as raw GedcomX JSON."""
    res = await db.execute(select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id)))
    batch = res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if not batch.tree_data:
        raise HTTPException(status_code=400, detail="No tree built yet.")
    filename = f"{batch.name.replace(' ', '_')}.json"
    return Response(
        content=batch.tree_data,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
