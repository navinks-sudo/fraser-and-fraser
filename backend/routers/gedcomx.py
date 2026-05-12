from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import json
from backend.database import get_db
from backend.models import Record, GedcomXRecord, Image
from backend.services.gedcomx_service import GedcomXService
from backend.core.dependencies import get_current_user

router = APIRouter(prefix="/projects/{project_id}/batches/{batch_id}/gedcomx", tags=["gedcomx"])
gedcomx_service = GedcomXService()

@router.post("/{image_id}/generate")
async def generate_gedcomx(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Record).where(Record.image_id == image_id))
    record = result.scalars().first()
    if not record:
        raise HTTPException(status_code=400, detail="Record extraction required for GedcomX")

    record_data = {
        "event_type": record.event_type,
        "given_name": record.given_name,
        "surname": record.surname,
        "date_of_event": record.date_of_event,
        "father_name": record.father_name,
        "mother_name": record.mother_name,
        "family_members": json.loads(record.family_members) if record.family_members else []
    }
    
    try:
        gedcomx_json = await gedcomx_service.generate_gedcomx(record_data)
        
        result = await db.execute(select(GedcomXRecord).where(GedcomXRecord.record_id == record.id))
        db_gedcomx = result.scalars().first()
        
        if db_gedcomx:
            db_gedcomx.gedcomx_json = json.dumps(gedcomx_json)
        else:
            db_gedcomx = GedcomXRecord(
                record_id=record.id,
                gedcomx_json=json.dumps(gedcomx_json)
            )
            db.add(db_gedcomx)
            
        result = await db.execute(select(Image).where(Image.id == image_id))
        image = result.scalars().first()
        image.gedcomx_status = 'done'
        
        await db.commit()
        return gedcomx_json
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{image_id}")
async def get_gedcomx(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Record).where(Record.image_id == image_id))
    record = result.scalars().first()
    if not record:
        return None
        
    result = await db.execute(select(GedcomXRecord).where(GedcomXRecord.record_id == record.id))
    db_gedcomx = result.scalars().first()
    if db_gedcomx:
        return json.loads(db_gedcomx.gedcomx_json)
    return None
