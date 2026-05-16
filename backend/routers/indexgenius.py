from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List
import json
from backend.database import get_db
from backend.models import OCRText, Record, Image
from backend.services.indexgenius_service import IndexGeniusService
from backend.services.ai_service import ai_service
from backend.services import tree_autobuild
from backend.schemas.record import (
    RecordExtraction, FamilyMember, Person, Relation, MetadataField,
)
from backend.core.dependencies import get_current_user

router = APIRouter(prefix="/projects/{project_id}/batches/{batch_id}/indexgenius", tags=["indexgenius"])
indexgenius_service = IndexGeniusService()


def _build_extraction_from_spreadsheet(raw: dict) -> RecordExtraction:
    """Normalise Gemini's spreadsheet-extraction output into a RecordExtraction."""
    persons = []
    for p in raw.get("persons") or []:
        if not isinstance(p, dict): continue
        name = (p.get("name") or "").strip()
        if not name: continue
        g = (p.get("gender") or "").strip().upper()
        if g not in {"M", "F"}: g = "U"
        persons.append(Person(
            name=name, gender=g,
            role=(p.get("role") or "").strip().lower() or None,
            age=p.get("age"),
            date_of_birth=p.get("date_of_birth"),
            date_of_death=p.get("date_of_death"),
            occupation=p.get("occupation"),
            place=p.get("place"),
            confidence=p.get("confidence"),
        ))
    valid_names = {p.name for p in persons}
    relations = []
    seen = set()
    for r in raw.get("relations") or []:
        if not isinstance(r, dict): continue
        a = (r.get("person_a") or "").strip()
        b = (r.get("person_b") or "").strip()
        t = (r.get("type") or "").strip().lower()
        if not a or not b or a == b or not t: continue
        if a not in valid_names and b not in valid_names: continue
        key = (a, b, t)
        if key in seen: continue
        seen.add(key)
        relations.append(Relation(person_a=a, person_b=b, type=t, confidence=r.get("confidence")))
    metadata = []
    seen_meta = set()
    for m in raw.get("metadata") or []:
        if not isinstance(m, dict): continue
        label = (m.get("label") or "").strip()
        value = (m.get("value") or "").strip()
        if not label or not value: continue
        k = (label.lower(), value.lower())
        if k in seen_meta: continue
        seen_meta.add(k)
        metadata.append(MetadataField(
            label=label, value=value,
            category=(m.get("category") or "").strip().lower() or None,
            confidence=m.get("confidence"),
            notes=m.get("notes"),
        ))
    return RecordExtraction(
        persons=persons, relations=relations, metadata=metadata,
        family_members=[],
        additional_info=raw.get("additional_info") or {},
    )


@router.post("/{image_id}/extract", response_model=List[RecordExtraction])
async def extract_records(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    # Look up the image first — spreadsheet uploads bypass the OCR step entirely.
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalars().first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    try:
        if image.file_type == "spreadsheet":
            if not image.spreadsheet_data:
                raise HTTPException(status_code=400, detail="Spreadsheet not parsed.")
            ss = json.loads(image.spreadsheet_data)
            raw = await ai_service.extract_from_spreadsheet(ss.get("sheets") or [])
            extraction = _build_extraction_from_spreadsheet(raw)
        else:
            result = await db.execute(select(OCRText).where(OCRText.image_id == image_id))
            ocr = result.scalars().first()
            if not ocr or not ocr.current_text:
                raise HTTPException(status_code=400, detail="OCR text required for extraction")
            image_path = image.enhanced_path or image.original_path
            extraction = await indexgenius_service.extract_record(ocr.current_text, image_path=image_path)
        
        # Save to DB (In real app, might handle multiple records per image)
        # For MVP, we save one primary record
        result = await db.execute(select(Record).where(Record.image_id == image_id))
        db_record = result.scalars().first()
        
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
            for key, value in record_data.items():
                setattr(db_record, key, value)
        else:
            db_record = Record(image_id=image_id, **record_data)
            db.add(db_record)
        
        result = await db.execute(select(Image).where(Image.id == image_id))
        image = result.scalars().first()
        image.indexgenius_status = 'done'

        await db.commit()

        # Fire-and-forget: rebuild the batch tree now that this image has fresh
        # extractions. The autobuild helper coalesces concurrent triggers so
        # bulk re-extracts don't spawn N parallel Gemini calls.
        tree_autobuild.schedule(batch_id)

        return [extraction]
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        # Forward Gemini transient errors with their actual status so the UI
        # can show a precise "model overloaded, retry" instead of a generic 500.
        if "503" in msg or "UNAVAILABLE" in msg or "overloaded" in msg.lower():
            raise HTTPException(
                status_code=503,
                detail="Gemini model is temporarily overloaded — please retry in a minute.",
            )
        if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
            raise HTTPException(
                status_code=429,
                detail="Gemini quota exhausted — wait a minute and try again, or check your API key plan.",
            )
        raise HTTPException(status_code=500, detail=msg)

@router.get("/{image_id}")
async def get_records(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Record).where(Record.image_id == image_id))
    records = result.scalars().all()
    out = []
    for r in records:
        out.append({
            "id": r.id,
            "image_id": r.image_id,
            "record_number": r.record_number,
            "event_type": r.event_type,
            "given_name": r.given_name,
            "surname": r.surname,
            "date_of_birth": r.date_of_birth,
            "date_of_death": r.date_of_death,
            "date_of_event": r.date_of_event,
            "place_of_event": getattr(r, "place_of_event", None),
            "father_name": r.father_name,
            "mother_name": r.mother_name,
            "family_members": json.loads(r.family_members) if r.family_members else [],
            "persons": json.loads(r.persons_extracted) if getattr(r, "persons_extracted", None) else [],
            "relations": json.loads(r.relations_extracted) if getattr(r, "relations_extracted", None) else [],
            "metadata": json.loads(r.metadata_extracted) if getattr(r, "metadata_extracted", None) else [],
            "field_confidences": json.loads(r.field_confidences) if getattr(r, "field_confidences", None) else {},
            "additional_info": json.loads(r.additional_info) if r.additional_info else {},
            "has_edits": r.has_edits,
        })
    return out
