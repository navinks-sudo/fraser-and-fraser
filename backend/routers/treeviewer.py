from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import json
import logging
from datetime import datetime
from typing import Any, Dict

from backend.database import get_db
from backend.models import Record, GedcomXRecord, Image, Batch
from backend.services.treeviewer_service import TreeViewerService
from backend.services.gedcomx_service import _dedupe_persons as _normalise_gedcomx_persons
from backend.services.gedcom_export import gedcomx_to_gedcom
from backend.services.ai_service import ai_service
from backend.services import tree_autobuild
from backend.core.dependencies import get_current_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/batches/{batch_id}", tags=["treeviewer"])
tree_service = TreeViewerService()


# --- per-image (legacy) ---
@router.get("/treeviewer/{image_id}")
async def get_tree_data(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Record).where(Record.image_id == image_id))
    record = result.scalars().first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    result = await db.execute(select(GedcomXRecord).where(GedcomXRecord.record_id == record.id))
    db_gedcomx = result.scalars().first()

    if not db_gedcomx:
        raise HTTPException(status_code=400, detail="GedcomX generation required for tree view")

    gedcomx = json.loads(db_gedcomx.gedcomx_json)
    return tree_service.gedcomx_to_d3(gedcomx)


# --- auto-build status (poll this to surface "Tree auto-building…" in UI) ---
@router.get("/tree/build/status")
async def auto_build_status(
    project_id: int,
    batch_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Returns the current state of the per-batch auto-build worker:
      { status: 'idle' | 'building', started_at, finished_at, last_error,
        persons_count, relationships_count, last_built_at }
    """
    return tree_autobuild.get_status(batch_id)


# --- whole-batch tree (deterministic + optional AI enhancement) ---
@router.post("/tree/build")
async def build_batch_tree(
    project_id: int,
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Build the whole-batch family tree.

    Goes through the same path the auto-builder uses: a deterministic tree is
    constructed straight from the extracted persons/relations in every Record,
    then Gemini is asked (best-effort) to enhance it. If Gemini fails or
    returns less data than the deterministic tree, the deterministic tree wins.
    """
    res = await db.execute(
        select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id))
    )
    batch = res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Delegate to the shared auto-build worker so this path produces the
    # exact same result.
    await tree_autobuild._do_build(batch_id)

    # Reload to get the freshly-saved tree
    await db.refresh(batch)
    if not batch.tree_data:
        raise HTTPException(
            status_code=400,
            detail="No records with extracted persons yet — run IndexGenius extraction first.",
        )
    try:
        tree = json.loads(batch.tree_data)
    except json.JSONDecodeError:
        tree = {"persons": [], "relationships": []}

    return {
        "persons_count": batch.tree_persons_count or 0,
        "relationships_count": batch.tree_relationships_count or 0,
        "built_at": batch.tree_built_at.isoformat() if batch.tree_built_at else None,
        "tree": tree,
    }


@router.put("/tree/data")
async def save_batch_tree(
    project_id: int,
    batch_id: int,
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Save a user-edited GedcomX tree for this batch.

    Accepts {gedcomx: {...}} or a raw GedcomX object directly. Normalises and
    persists to Batch.tree_data, updating counts + timestamp.
    """
    res = await db.execute(
        select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id))
    )
    batch = res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    raw = payload.get("gedcomx") if isinstance(payload, dict) and "gedcomx" in payload else payload
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="Body must be a GedcomX object or {gedcomx:{…}}.")

    # User-edited tree comes in already-normalised; just run the dedupe pass to
    # collapse any subset-name duplicates the user might have introduced.
    persons = raw.get("persons") or []
    rels = raw.get("relationships") or []
    merged_p, merged_r = _normalise_gedcomx_persons(persons, rels)
    cleaned = {"persons": merged_p, "relationships": merged_r}
    persons = cleaned.get("persons") or []
    rels = cleaned.get("relationships") or []

    batch.tree_data = json.dumps(cleaned, ensure_ascii=False)
    batch.tree_persons_count = len(persons)
    batch.tree_relationships_count = len(rels)
    batch.tree_built_at = datetime.utcnow()
    await db.commit()

    return {
        "persons_count": len(persons),
        "relationships_count": len(rels),
        "built_at": batch.tree_built_at.isoformat(),
        "saved": True,
    }


# --- per-image deterministic tree ---
@router.get("/tree/image/{image_id}")
async def get_image_tree(
    project_id: int,
    batch_id: int,
    image_id: int,
    format: str = "d3",  # 'd3' | 'gedcomx'
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return a clean family tree built from JUST this image's extracted record.

    Uses the same deterministic builder as the whole-batch tree but scoped to
    one record — so each certificate gets its own self-contained family unit,
    no cross-record persons mixed in.
    """
    res = await db.execute(
        select(Record, Image)
        .join(Image, Record.image_id == Image.id)
        .where(Record.image_id == image_id, Image.batch_id == batch_id)
    )
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="No record for this image")
    record, image = row

    def _safe_json(s, default):
        try:
            return json.loads(s) if s else default
        except json.JSONDecodeError:
            return default

    payload = [{
        "image_id": record.image_id,
        "image_filename": image.original_filename,
        "given_name": record.given_name,
        "surname": record.surname,
        "event_type": record.event_type,
        "date_of_birth": record.date_of_birth,
        "date_of_death": record.date_of_death,
        "date_of_event": record.date_of_event,
        "father_name": record.father_name,
        "mother_name": record.mother_name,
        "family_members": _safe_json(record.family_members, []),
        "persons":  _safe_json(record.persons_extracted, []),
        "relations": _safe_json(record.relations_extracted, []),
    }]

    gedcomx = tree_autobuild.build_deterministic_tree(payload)
    persons = gedcomx.get("persons") or []
    rels = gedcomx.get("relationships") or []

    if format == "gedcomx":
        return {
            "gedcomx": gedcomx,
            "persons_count": len(persons),
            "relationships_count": len(rels),
            "image_id": image_id,
            "image_filename": image.original_filename,
        }
    return {
        "tree": tree_service.gedcomx_to_d3(gedcomx),
        "gedcomx": gedcomx,
        "persons_count": len(persons),
        "relationships_count": len(rels),
        "image_id": image_id,
        "image_filename": image.original_filename,
    }


# ─── Per-image GEDCOM exports ───────────────────────────────────────────
@router.get("/tree/image/{image_id}/export.ged")
async def export_image_gedcom(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Download this image's family tree as a GEDCOM 5.5 file (.ged).
    Compatible with FamilySearch, Ancestry, MyHeritage, Gramps, etc.
    """
    gedcomx = await _per_image_gedcomx(db, project_id, batch_id, image_id)
    res = await db.execute(select(Image).where(Image.id == image_id))
    image = res.scalars().first()
    fname_base = (image.original_filename if image else f"image-{image_id}").rsplit(".", 1)[0]
    text = gedcomx_to_gedcom(gedcomx, submitter=f"SBL Infotech · {fname_base}")
    return Response(
        content=text,
        media_type="text/x-gedcom",
        headers={"Content-Disposition": f'attachment; filename="{fname_base}.ged"'},
    )


@router.get("/tree/image/{image_id}/export.json")
async def export_image_gedcomx_json(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Download this image's family tree as raw GedcomX JSON (developer format)."""
    gedcomx = await _per_image_gedcomx(db, project_id, batch_id, image_id)
    res = await db.execute(select(Image).where(Image.id == image_id))
    image = res.scalars().first()
    fname_base = (image.original_filename if image else f"image-{image_id}").rsplit(".", 1)[0]
    return Response(
        content=json.dumps(gedcomx, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{fname_base}.gedcomx.json"'},
    )


@router.put("/tree/image/{image_id}/save")
async def save_image_tree(
    project_id: int,
    batch_id: int,
    image_id: int,
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Save user-edited GedcomX for this image. Stored in the GedcomXRecord
    table keyed to the underlying Record so subsequent loads use the saved
    version instead of re-deriving from extraction."""
    res = await db.execute(
        select(Record).join(Image, Record.image_id == Image.id)
                      .where(Record.image_id == image_id, Image.batch_id == batch_id)
    )
    record = res.scalars().first()
    if not record:
        raise HTTPException(status_code=404, detail="No record for this image")

    raw = payload.get("gedcomx") if isinstance(payload, dict) and "gedcomx" in payload else payload
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="Body must be {gedcomx: {...}} or a GedcomX object.")
    persons = raw.get("persons") or []
    rels = raw.get("relationships") or []
    merged_p, merged_r = _normalise_gedcomx_persons(persons, rels)
    cleaned = {"persons": merged_p, "relationships": merged_r}

    res = await db.execute(select(GedcomXRecord).where(GedcomXRecord.record_id == record.id))
    gx = res.scalars().first()
    body_json = json.dumps(cleaned, ensure_ascii=False)
    if gx:
        gx.gedcomx_json = body_json
        gx.updated_at = datetime.utcnow()
    else:
        db.add(GedcomXRecord(record_id=record.id, gedcomx_json=body_json))
    await db.commit()

    return {
        "saved": True,
        "image_id": image_id,
        "persons_count": len(merged_p),
        "relationships_count": len(merged_r),
        "saved_at": datetime.utcnow().isoformat(),
    }


async def _per_image_gedcomx(db: AsyncSession, project_id: int, batch_id: int, image_id: int) -> dict:
    """Resolve the GedcomX for one image — saved version takes priority,
    falling back to the deterministic build from extracted persons/relations."""
    res = await db.execute(
        select(Record, Image).join(Image, Record.image_id == Image.id)
                             .where(Record.image_id == image_id, Image.batch_id == batch_id)
    )
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="No record for this image")
    record, image = row

    # Prefer saved/edited GedcomX
    res = await db.execute(select(GedcomXRecord).where(GedcomXRecord.record_id == record.id))
    saved = res.scalars().first()
    if saved and saved.gedcomx_json:
        try:
            return json.loads(saved.gedcomx_json)
        except json.JSONDecodeError:
            pass

    # Else build deterministically from the extracted data
    def _safe_json(s, default):
        try:
            return json.loads(s) if s else default
        except json.JSONDecodeError:
            return default

    payload = [{
        "image_id": record.image_id,
        "image_filename": image.original_filename,
        "given_name": record.given_name,
        "surname": record.surname,
        "event_type": record.event_type,
        "date_of_birth": record.date_of_birth,
        "date_of_death": record.date_of_death,
        "date_of_event": record.date_of_event,
        "father_name": record.father_name,
        "mother_name": record.mother_name,
        "family_members": _safe_json(record.family_members, []),
        "persons":  _safe_json(record.persons_extracted, []),
        "relations": _safe_json(record.relations_extracted, []),
    }]
    return tree_autobuild.build_deterministic_tree(payload)


# ─── External-app webhook ───────────────────────────────────────────────
@router.post("/tree/image/{image_id}/webhook")
async def push_image_to_webhook(
    project_id: int,
    batch_id: int,
    image_id: int,
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """POST this image's GedcomX to an external URL.

    Body: { url: 'https://...', headers?: {...}, format?: 'gedcomx' | 'gedcom' }
    Used to connect to external genealogy services that accept inbound
    pushes (custom integrations, internal CRMs, Zapier hooks, etc.).
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object.")
    url = (payload.get("url") or "").strip()
    if not url or not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="A valid http(s) `url` is required.")
    fmt = (payload.get("format") or "gedcomx").lower()
    extra_headers = payload.get("headers") or {}
    if not isinstance(extra_headers, dict):
        raise HTTPException(status_code=400, detail="`headers` must be an object.")

    gedcomx = await _per_image_gedcomx(db, project_id, batch_id, image_id)

    if fmt == "gedcom":
        body = gedcomx_to_gedcom(gedcomx, submitter="SBL Infotech")
        content_type = "text/x-gedcom"
    else:
        body = json.dumps(gedcomx, ensure_ascii=False)
        content_type = "application/json"

    import httpx
    headers = {"Content-Type": content_type, **{str(k): str(v) for k, v in extra_headers.items()}}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, content=body, headers=headers)
    except Exception as e:
        log.warning("Webhook POST failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Failed to reach webhook: {e}")

    return {
        "sent": True,
        "url": url,
        "format": fmt,
        "remote_status": r.status_code,
        "remote_body_preview": r.text[:500],
        "bytes_sent": len(body),
    }


@router.get("/tree/data")
async def get_batch_tree(
    project_id: int,
    batch_id: int,
    format: str = "d3",  # 'd3' | 'gedcomx'
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return the saved Gemini-built tree for this batch.

    `format=d3` (default) returns a hierarchy ready for react-d3-tree.
    `format=gedcomx` returns the raw GedcomX as Gemini produced it.
    """
    res = await db.execute(
        select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id))
    )
    batch = res.scalars().first()
    if not batch or not batch.tree_data:
        return None

    try:
        gedcomx = json.loads(batch.tree_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Stored tree data is corrupted.")

    if format == "gedcomx":
        return {
            "gedcomx": gedcomx,
            "persons_count": batch.tree_persons_count,
            "relationships_count": batch.tree_relationships_count,
            "built_at": batch.tree_built_at.isoformat() if batch.tree_built_at else None,
        }

    return {
        "tree": tree_service.gedcomx_to_d3(gedcomx),
        "persons_count": batch.tree_persons_count,
        "relationships_count": batch.tree_relationships_count,
        "built_at": batch.tree_built_at.isoformat() if batch.tree_built_at else None,
    }
