from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List
from pathlib import Path
import json
from backend.database import get_db
from backend.models import Image, Batch, Project, User
from backend.services.file_service import FileService
from backend.services.spreadsheet_service import is_spreadsheet, parse_spreadsheet
from backend.services.pdf_service import is_pdf, split_pdf_to_pngs
from backend.core.dependencies import get_current_user

router = APIRouter(prefix="/projects/{project_id}/batches/{batch_id}/images", tags=["images"])
file_service = FileService()

@router.post("/")
async def upload_images(
    project_id: int,
    batch_id: int,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    # Verify project/batch ownership
    result = await db.execute(select(User).where(User.username == current_user["username"]))
    user = result.scalars().first()
    
    # Check batch exists
    result = await db.execute(select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id)))
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Pull the parent project so single-family auto-grouping works on upload.
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalars().first()
    auto_group_id = None
    auto_group_label = None
    if project and getattr(project, "research_mode", "mixed") == "single_family":
        # Deterministic id so every batch in this project shares the same group
        auto_group_id = f"fg_proj_{project.id}"
        auto_group_label = (project.family_label or project.name or "Family").strip()

    uploaded_images = []
    for file in files:
        file_bytes = await file.read()

        # ---- PDF: split each page into its own image row -------------------
        if is_pdf(file.filename):
            try:
                page_pngs = split_pdf_to_pngs(file_bytes)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to read PDF '{file.filename}': {e}")

            base_name = Path(file.filename).stem
            total_pages = len(page_pngs)
            width = max(2, len(str(total_pages)))
            for idx, png_bytes in enumerate(page_pngs, start=1):
                page_filename = f"{base_name}_p{str(idx).zfill(width)}.png"
                page_path = file_service.save_original(
                    user.id, project_id, batch_id, png_bytes, page_filename,
                )
                page_image = Image(
                    batch_id=batch_id,
                    original_filename=page_filename,
                    original_path=page_path,
                    sort_order=batch.image_count,
                    file_type="image",
                    family_group_id=auto_group_id,
                    family_group_label=auto_group_label,
                )
                db.add(page_image)
                batch.image_count += 1
                uploaded_images.append(page_image)
            continue

        # ---- everything else: image or spreadsheet -------------------------
        file_path = file_service.save_original(user.id, project_id, batch_id, file_bytes, file.filename)

        is_excel = is_spreadsheet(file.filename)
        new_image = Image(
            batch_id=batch_id,
            original_filename=file.filename,
            original_path=file_path,
            sort_order=batch.image_count,
            file_type="spreadsheet" if is_excel else "image",
            visionmax_status="skipped" if is_excel else "pending",
            textiq_status="skipped" if is_excel else "pending",
            segment_status="skipped" if is_excel else "pending",
            family_group_id=auto_group_id,
            family_group_label=auto_group_label,
        )

        if is_excel:
            try:
                parsed = parse_spreadsheet(file_path)
                new_image.spreadsheet_data = json.dumps(parsed, ensure_ascii=False)
            except Exception as e:
                new_image.spreadsheet_data = json.dumps({"error": str(e), "sheets": []})

        db.add(new_image)
        batch.image_count += 1
        uploaded_images.append(new_image)

    await db.commit()
    return {
        "message": f"Successfully uploaded {len(files)} file(s) — produced {len(uploaded_images)} image row(s)",
        "rows_created": len(uploaded_images),
    }

@router.get("/")
async def get_images(
    project_id: int,
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(select(Image).where(Image.batch_id == batch_id).order_by(Image.sort_order))
    rows = result.scalars().all()
    out = []
    for r in rows:
        sheet_summary = None
        if r.file_type == "spreadsheet" and r.spreadsheet_data:
            try:
                ss = json.loads(r.spreadsheet_data)
                first = (ss.get("sheets") or [{}])[0]
                sheet_summary = {
                    "sheet_count": len(ss.get("sheets") or []),
                    "first_sheet": first.get("name"),
                    "row_count": first.get("row_count", 0),
                    "column_count": len(first.get("columns") or []),
                }
            except json.JSONDecodeError:
                pass
        out.append({
            "id": r.id,
            "batch_id": r.batch_id,
            "original_filename": r.original_filename,
            "original_path": r.original_path,
            "enhanced_path": r.enhanced_path,
            "has_enhancement": r.has_enhancement,
            "visionmax_status": r.visionmax_status,
            "textiq_status": r.textiq_status,
            "indexgenius_status": r.indexgenius_status,
            "gedcomx_status": r.gedcomx_status,
            "segment_status": r.segment_status,
            "file_type": r.file_type or "image",
            "rotation": r.rotation or 0,
            "sort_order": r.sort_order,
            "family_group_id": r.family_group_id,
            "family_group_label": r.family_group_label,
            "created_at": r.created_at,
            "spreadsheet_summary": sheet_summary,
        })
    return out


@router.get("/{image_id}/spreadsheet")
async def get_spreadsheet(
    project_id: int,
    batch_id: int,
    image_id: int,
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return parsed spreadsheet contents.

    Big files (10k+ rows × dozens of columns) crush both the wire and the
    browser, so by default we cap the row preview at 200 per sheet. The full
    data is still on the server and is what AI extraction sees. Pass
    ``limit=0`` to bypass the cap.
    """
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalars().first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    if image.file_type != "spreadsheet" or not image.spreadsheet_data:
        raise HTTPException(status_code=400, detail="Not a spreadsheet upload.")
    try:
        data = json.loads(image.spreadsheet_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Stored spreadsheet data is corrupted.")

    if limit and limit > 0:
        truncated_any = False
        for sheet in data.get("sheets") or []:
            rows = sheet.get("rows") or []
            sheet["total_rows"] = len(rows)
            if len(rows) > limit:
                sheet["rows"] = rows[:limit]
                sheet["preview_truncated"] = True
                sheet["preview_limit"] = limit
                truncated_any = True
            else:
                sheet["preview_truncated"] = False
        data["preview_truncated"] = truncated_any
        data["preview_limit"] = limit
    return data


@router.post("/{image_id}/rotate")
async def rotate_image(
    project_id: int,
    batch_id: int,
    image_id: int,
    degrees: int = 90,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Add `degrees` to the image's rotation (modulo 360). Rotation is stored
    on the DB row and applied via CSS in the viewer — original file is never
    modified."""
    result = await db.execute(
        select(Image).where((Image.id == image_id) & (Image.batch_id == batch_id))
    )
    image = result.scalars().first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    new = ((image.rotation or 0) + int(degrees)) % 360
    image.rotation = new
    await db.commit()
    return {"id": image.id, "rotation": new}


@router.delete("/{image_id}")
async def delete_image(
    project_id: int,
    batch_id: int,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    result = await db.execute(
        select(Image).where((Image.id == image_id) & (Image.batch_id == batch_id))
    )
    image = result.scalars().first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    for path in (image.original_path, image.enhanced_path, image.enhanced_backup_path):
        if path:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass

    result = await db.execute(select(Batch).where(Batch.id == batch_id))
    batch = result.scalars().first()
    if batch and batch.image_count and batch.image_count > 0:
        batch.image_count -= 1

    await db.delete(image)
    await db.commit()
    return {"message": "Image deleted"}
