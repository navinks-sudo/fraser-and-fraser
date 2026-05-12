from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List
from backend.database import get_db
from backend.models import Batch, Project, User
from backend.schemas.batch import BatchCreate, BatchResponse, BatchUpdate
from backend.services.file_service import FileService
from backend.core.dependencies import get_current_user

file_service = FileService()

router = APIRouter(prefix="/projects/{project_id}/batches", tags=["batches"])

@router.post("/", response_model=BatchResponse)
async def create_batch(
    project_id: int,
    batch_data: BatchCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    # Verify project exists and belongs to user
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalars().first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    new_batch = Batch(
        project_id=project_id,
        name=batch_data.name,
        description=batch_data.description
    )
    db.add(new_batch)
    await db.commit()
    await db.refresh(new_batch)
    return new_batch

@router.get("/", response_model=List[BatchResponse])
async def get_batches(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Batch).where(Batch.project_id == project_id))
    return result.scalars().all()

@router.delete("/{batch_id}")
async def delete_batch(
    project_id: int,
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id)))
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    result = await db.execute(select(User).where(User.username == current_user["username"]))
    user = result.scalars().first()
    if user:
        file_service.delete_batch_files(user.id, project_id, batch_id)

    await db.delete(batch)
    await db.commit()
    return {"message": "Batch deleted successfully"}
