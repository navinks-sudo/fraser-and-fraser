from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from openai import APIConnectionError, APITimeoutError, APIError
import json
from backend.database import get_db
from backend.models import Image, OCRText
from backend.services.textiq_service import TextIQService
from backend.services.segment_service import SegmentService
from backend.services.translation_service import TranslationService
from backend.core.dependencies import get_current_user

router = APIRouter(prefix="/projects/{project_id}/batches/{batch_id}/textiq", tags=["textiq"])
textiq_service = TextIQService()
segment_service = SegmentService()
translation_service = TranslationService()

@router.post("/{image_id}/process")
async def process_ocr(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalars().first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Determine source image (enhanced or original)
    source_path = image.enhanced_path if image.enhanced_path else image.original_path

    try:
        result_data = await textiq_service.perform_ocr(source_path)
        # Backward-compat: tolerate legacy plain-string returns
        if isinstance(result_data, str):
            result_data = {"text": result_data, "words": [], "chars": [], "avg_confidence": None}

        ocr_text = result_data.get("text") or ""

        # Save to DB
        result = await db.execute(select(OCRText).where(OCRText.image_id == image_id))
        db_ocr = result.scalars().first()

        # Stash full-page confidence as a single "region" (index = 0) so the
        # frontend confidence renderer can light up even without segmentation.
        page_region = {
            "index": 0,
            "bbox": None,
            "summary": "Whole page",
            "language": None,
            "text": ocr_text,
            "words": result_data.get("words") or [],
            "chars": result_data.get("chars") or [],
            "avg_confidence": result_data.get("avg_confidence"),
            "low_confidence_count": result_data.get("low_confidence_count"),
            "confidence_source": result_data.get("confidence_source"),
        }

        if db_ocr:
            db_ocr.current_text = ocr_text
            if not db_ocr.original_text:
                db_ocr.original_text = ocr_text
            db_ocr.regions = json.dumps([page_region], ensure_ascii=False)
        else:
            db_ocr = OCRText(
                image_id=image_id,
                current_text=ocr_text,
                original_text=ocr_text,
                regions=json.dumps([page_region], ensure_ascii=False),
            )
            db.add(db_ocr)

        image.textiq_status = 'done'
        await db.commit()
        return {
            "text": ocr_text,
            "avg_confidence": result_data.get("avg_confidence"),
            "low_confidence_count": result_data.get("low_confidence_count"),
            "confidence_source": result_data.get("confidence_source"),
        }
    except (APIConnectionError, APITimeoutError) as e:
        image.textiq_status = 'error'
        await db.commit()
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not reach the OCR model endpoint "
                f"({type(e).__name__}). Check OPENAI_BASE_URL in .env or your "
                "network/VPN — the configured host may not be accessible."
            ),
        )
    except APIError as e:
        image.textiq_status = 'error'
        await db.commit()
        raise HTTPException(status_code=502, detail=f"OCR model error: {e}")
    except Exception as e:
        image.textiq_status = 'error'
        await db.commit()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{image_id}")
async def get_ocr_text(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(OCRText).where(OCRText.image_id == image_id))
    db_ocr = result.scalars().first()
    if not db_ocr:
        return None
    payload = {
        "id": db_ocr.id,
        "image_id": db_ocr.image_id,
        "current_text": db_ocr.current_text,
        "original_text": db_ocr.original_text,
        "has_edits": db_ocr.has_edits,
        "language_detected": db_ocr.language_detected,
        "translation_en": db_ocr.translation_en,
        "regions": None,
    }
    if db_ocr.regions:
        try:
            payload["regions"] = json.loads(db_ocr.regions)
        except json.JSONDecodeError:
            payload["regions"] = None
    return payload

@router.post("/{image_id}/process-regions")
async def process_regions_ocr(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Run OCR on each detected region with word/char confidence scoring."""
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalars().first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    if not image.region_data:
        raise HTTPException(
            status_code=400,
            detail="No regions detected yet. Run /segment first.",
        )

    try:
        regions_meta = json.loads(image.region_data) or {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Stored region data is corrupted.")

    regions = regions_meta.get("regions") or []
    if not regions:
        raise HTTPException(status_code=400, detail="No regions to process.")

    source_path = image.enhanced_path or image.original_path
    output_regions = []
    aggregated_text_parts = []

    try:
        for r in regions:
            data = await textiq_service.ocr_region(source_path, r.get("bbox") or [])
            output_regions.append({
                "index": r.get("index"),
                "bbox": r.get("bbox"),
                "summary": r.get("summary"),
                "language": r.get("language"),
                "text": data.get("text") or "",
                "words": data.get("words") or [],
                "chars": data.get("chars") or [],
                "avg_confidence": data.get("avg_confidence"),
                "low_confidence_count": data.get("low_confidence_count"),
                "confidence_source": data.get("confidence_source"),
            })
            if data.get("text"):
                aggregated_text_parts.append(f"[Region {r.get('index')}]")
                aggregated_text_parts.append(data["text"])
                aggregated_text_parts.append("")
    except (APIConnectionError, APITimeoutError) as e:
        image.textiq_status = "error"
        await db.commit()
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach the OCR model endpoint ({type(e).__name__}). Check OPENAI_BASE_URL.",
        )
    except APIError as e:
        image.textiq_status = "error"
        await db.commit()
        raise HTTPException(status_code=502, detail=f"OCR model error: {e}")

    aggregated_text = "\n".join(aggregated_text_parts).strip()

    # Persist on the OCRText row (one row per image)
    result = await db.execute(select(OCRText).where(OCRText.image_id == image_id))
    db_ocr = result.scalars().first()
    if db_ocr:
        db_ocr.current_text = aggregated_text
        if not db_ocr.original_text:
            db_ocr.original_text = aggregated_text
        db_ocr.regions = json.dumps(output_regions, ensure_ascii=False)
    else:
        db_ocr = OCRText(
            image_id=image_id,
            current_text=aggregated_text,
            original_text=aggregated_text,
            regions=json.dumps(output_regions, ensure_ascii=False),
        )
        db.add(db_ocr)

    image.textiq_status = "done"
    await db.commit()
    return {
        "regions": output_regions,
        "aggregated_text": aggregated_text,
    }


@router.post("/{image_id}/translate")
async def translate_ocr(
    project_id: int,
    batch_id: int,
    image_id: int,
    region_index: int | None = None,
    target: str = "en",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Translate the OCR text (whole page or single region) to English."""
    result = await db.execute(select(OCRText).where(OCRText.image_id == image_id))
    db_ocr = result.scalars().first()
    if not db_ocr:
        raise HTTPException(status_code=404, detail="No OCR text for this image yet.")

    text_to_translate: str | None = None
    if region_index is not None and db_ocr.regions:
        try:
            regions = json.loads(db_ocr.regions) or []
        except json.JSONDecodeError:
            regions = []
        match = next((r for r in regions if r.get("index") == region_index), None)
        if not match:
            raise HTTPException(status_code=404, detail=f"Region {region_index} not found.")
        text_to_translate = match.get("text") or ""
    else:
        text_to_translate = db_ocr.current_text or ""

    if not text_to_translate.strip():
        raise HTTPException(status_code=400, detail="No text to translate.")

    try:
        result_data = await translation_service.translate_to_english(text_to_translate)
    except (APIConnectionError, APITimeoutError) as e:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach the translation endpoint ({type(e).__name__}).",
        )
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"Translation model error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    detected = result_data.get("language") or "und"
    translation = result_data.get("translation") or ""

    if region_index is not None and db_ocr.regions:
        try:
            regions = json.loads(db_ocr.regions) or []
            for r in regions:
                if r.get("index") == region_index:
                    r["language_detected"] = detected
                    r["translation_en"] = translation
                    break
            db_ocr.regions = json.dumps(regions, ensure_ascii=False)
        except json.JSONDecodeError:
            pass
    else:
        db_ocr.language_detected = detected
        db_ocr.translation_en = translation

    await db.commit()
    return {
        "region_index": region_index,
        "language_detected": detected,
        "translation": translation,
    }


@router.post("/{image_id}/segment")
async def segment_image(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalars().first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    source_path = image.enhanced_path or image.original_path

    try:
        regions = await segment_service.detect_regions(source_path)
        image.region_data = json.dumps(regions, ensure_ascii=False)
        image.segment_status = "done"
        await db.commit()
        return regions
    except (APIConnectionError, APITimeoutError) as e:
        image.segment_status = "error"
        await db.commit()
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not reach the vision model endpoint "
                f"({type(e).__name__}). Check OPENAI_BASE_URL in .env."
            ),
        )
    except APIError as e:
        image.segment_status = "error"
        await db.commit()
        raise HTTPException(status_code=502, detail=f"Vision model error: {e}")
    except Exception as e:
        image.segment_status = "error"
        await db.commit()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{image_id}/regions")
async def get_regions(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalars().first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    if not image.region_data:
        return None
    try:
        return json.loads(image.region_data)
    except json.JSONDecodeError:
        return None


@router.put("/{image_id}")
async def update_ocr_text(
    project_id: int,
    batch_id: int,
    image_id: int,
    text: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(OCRText).where(OCRText.image_id == image_id))
    db_ocr = result.scalars().first()
    if not db_ocr:
        raise HTTPException(status_code=404, detail="OCR text not found")
        
    db_ocr.current_text = text
    db_ocr.has_edits = True
    await db.commit()
    return {"message": "Text updated"}
