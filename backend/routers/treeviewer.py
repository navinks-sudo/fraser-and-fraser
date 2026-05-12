from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import json
from datetime import datetime
from typing import Any, Dict

from backend.database import get_db
from backend.models import Record, GedcomXRecord, Image, Batch
from backend.services.treeviewer_service import TreeViewerService
from backend.services.gemini_service import GeminiService, _normalise_gedcomx
from backend.core.dependencies import get_current_user

router = APIRouter(prefix="/projects/{project_id}/batches/{batch_id}", tags=["treeviewer"])
tree_service = TreeViewerService()
gemini_service = GeminiService()


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


# --- whole-batch tree (Gemini-built) ---
@router.post("/tree/build")
async def build_batch_tree(
    project_id: int,
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Run Gemini across every Record in this batch to dedupe persons and infer all
    parent/child/spouse relationships, then save the resulting GedcomX on the Batch."""
    if not gemini_service.is_configured:
        raise HTTPException(
            status_code=400,
            detail="GEMINI_API_KEY is not configured — required for AI-driven tree building.",
        )

    # Load batch
    res = await db.execute(
        select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id))
    )
    batch = res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Load every Record in this batch (across all images)
    res = await db.execute(
        select(Record, Image)
        .join(Image, Record.image_id == Image.id)
        .where(Image.batch_id == batch_id)
    )
    rows = res.all()
    if not rows:
        raise HTTPException(
            status_code=400,
            detail="No records to build a tree from. Run IndexGenius extraction first.",
        )

    records_payload = []
    for record, image in rows:
        records_payload.append({
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
            "family_members": json.loads(record.family_members) if record.family_members else [],
        })

    try:
        tree = await gemini_service.build_family_tree(records_payload)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini tree synthesis failed: {e}")

    persons = tree.get("persons") or []
    rels = tree.get("relationships") or []

    batch.tree_data = json.dumps(tree, ensure_ascii=False)
    batch.tree_persons_count = len(persons)
    batch.tree_relationships_count = len(rels)
    batch.tree_built_at = datetime.utcnow()
    await db.commit()

    return {
        "persons_count": len(persons),
        "relationships_count": len(rels),
        "built_at": batch.tree_built_at.isoformat(),
        "records_used": len(records_payload),
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

    cleaned = _normalise_gedcomx(raw)
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
