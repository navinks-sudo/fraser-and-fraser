from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from backend.database import get_db
from backend.models import Image, Batch
from backend.services.visionmax_service import VisionMaxService
from backend.services.file_service import FileService
from backend.services.quality_service import score_image, score_delta
from backend.core.dependencies import get_current_user

router = APIRouter(prefix="/projects/{project_id}/batches/{batch_id}/visionmax", tags=["visionmax"])
visionmax_service = VisionMaxService()
file_service = FileService()


@router.get("/{image_id}/quality")
async def get_image_quality(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Compute the multi-metric quality score for the original (and enhanced, if any)."""
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalars().first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    try:
        before = score_image(image.original_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to score original: {e}")

    after = None
    delta = None
    if image.enhanced_path:
        try:
            after = score_image(image.enhanced_path)
            delta = score_delta(before, after)
        except Exception:
            after = None

    return {"before": before, "after": after, "delta": delta}

@router.post("/{image_id}/enhance")
async def enhance_image(
    project_id: int,
    batch_id: int,
    image_id: int,
    brightness: float = 1.0,
    contrast: float = 1.0,
    sharpness: float = 1.0,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalars().first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Score the original BEFORE enhancement so the user always sees the baseline
    try:
        before_score = score_image(image.original_path)
    except Exception:
        before_score = None

    # Backup current enhanced if it exists
    if image.enhanced_path:
        file_service.backup_enhanced(image.enhanced_path)

    # Perform enhancement (using original as source for now to avoid cumulative degradation)
    enhanced_path = visionmax_service.enhance_image(
        image.original_path,
        brightness,
        contrast,
        sharpness
    )

    image.enhanced_path = enhanced_path
    image.has_enhancement = True
    image.visionmax_status = 'done'

    await db.commit()

    # Score the enhanced version
    try:
        after_score = score_image(enhanced_path)
    except Exception:
        after_score = None

    delta = (
        score_delta(before_score, after_score)
        if before_score and after_score
        else None
    )

    return {
        "enhanced_path": enhanced_path,
        "quality": {"before": before_score, "after": after_score, "delta": delta},
    }

@router.post("/{image_id}/revert")
async def revert_image(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalars().first()
    
    image.enhanced_path = None
    image.has_enhancement = False
    image.visionmax_status = 'pending'
    
    await db.commit()
    return {"message": "Reverted to original"}
