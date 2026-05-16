"""Family-group endpoints — auto-detect and persist which certificates in a
batch belong to the same family.

Endpoints:
  GET    /family-groups/suggest            — read-only auto-detection
  GET    /family-groups                    — list currently-applied groups
  POST   /family-groups/apply              — persist suggested groups in bulk
  PATCH  /family-groups/image/{image_id}   — manual move of one image
  DELETE /family-groups/{group_id}         — dissolve a group (members → standalone)
  GET    /tree/group/{group_id}            — merged tree for a group
"""
from __future__ import annotations

import json
import logging
import uuid
from collections import defaultdict
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from backend.core.dependencies import get_current_user
from backend.database import get_db
from backend.models import Batch, Image, Record
from backend.services import family_grouping, tree_autobuild
from backend.services.gedcom_export import gedcomx_to_gedcom
from backend.services.treeviewer_service import TreeViewerService

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/batches/{batch_id}",
    tags=["family-groups"],
)
tree_service = TreeViewerService()


# ─── Helpers ──────────────────────────────────────────────────────────────
async def _load_batch_data(
    db: AsyncSession, project_id: int, batch_id: int
) -> tuple[Batch, list[Image], dict[int, Record]]:
    res = await db.execute(
        select(Batch).where((Batch.id == batch_id) & (Batch.project_id == project_id))
    )
    batch = res.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    res = await db.execute(
        select(Image).where(Image.batch_id == batch_id).order_by(Image.sort_order)
    )
    images = res.scalars().all()

    image_ids = [i.id for i in images]
    records: dict[int, Record] = {}
    if image_ids:
        res = await db.execute(select(Record).where(Record.image_id.in_(image_ids)))
        for r in res.scalars().all():
            records[r.image_id] = r
    return batch, images, records


# Fixed palette so the frontend can colour-code ribbons consistently across
# sessions and visits — assigned by stable hash of the group id.
_RIBBON_COLORS = [
    "#E25E10",  # orange (brand)
    "#1F8AE6",  # blue
    "#5BB12F",  # green
    "#9333EA",  # violet
    "#0EA5A4",  # teal
    "#DB2777",  # pink
]


def _color_for(group_id: str) -> str:
    """Deterministic colour pick based on the group id."""
    h = 0
    for ch in group_id or "":
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return _RIBBON_COLORS[h % len(_RIBBON_COLORS)]


# ─── Endpoints ───────────────────────────────────────────────────────────
@router.get("/family-groups/suggest")
async def suggest_family_groups(
    project_id: int,
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Compute (without persisting) suggested family groups based on
    name-overlap across every image's extracted persons."""
    _, images, records = await _load_batch_data(db, project_id, batch_id)
    out = family_grouping.suggest_groups(records, images)
    # Decorate each suggestion with a colour for ribbons
    for g in out["groups"]:
        g["color"] = _color_for(g["suggested_id"])
    return out


@router.get("/family-groups")
async def list_family_groups(
    project_id: int,
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return the family groups currently persisted on this batch's images."""
    _, images, _ = await _load_batch_data(db, project_id, batch_id)
    bucket: dict[str, list[Image]] = defaultdict(list)
    label_for: dict[str, str | None] = {}
    for img in images:
        gid = img.family_group_id
        if not gid:
            continue
        bucket[gid].append(img)
        # Last write wins for label (they should all match within a group)
        if img.family_group_label:
            label_for[gid] = img.family_group_label
    groups = []
    for gid, members in bucket.items():
        groups.append({
            "id": gid,
            "label": label_for.get(gid) or "Family group",
            "color": _color_for(gid),
            "image_ids": sorted([m.id for m in members]),
        })
    groups.sort(key=lambda g: (-len(g["image_ids"]), g["image_ids"][0]))
    standalones = sorted([img.id for img in images if not img.family_group_id])
    return {"groups": groups, "standalones": standalones}


@router.post("/family-groups/apply")
async def apply_family_groups(
    project_id: int,
    batch_id: int,
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Persist a list of suggested groups.

    Body:
      { groups: [
          { id?: 'fg_xxx', label: 'Clifford family', image_ids: [3, 7, 11] },
          ...
        ],
        replace?: true          # if true, clears existing groupings first
      }
    """
    _, images, _ = await _load_batch_data(db, project_id, batch_id)
    images_by_id = {img.id: img for img in images}

    groups = payload.get("groups") or []
    if not isinstance(groups, list):
        raise HTTPException(status_code=400, detail="`groups` must be a list.")

    if payload.get("replace"):
        for img in images:
            img.family_group_id = None
            img.family_group_label = None

    applied = []
    for g in groups:
        if not isinstance(g, dict):
            continue
        gid = (g.get("id") or "").strip() or f"fg_{uuid.uuid4().hex[:10]}"
        label = (g.get("label") or "").strip() or "Family group"
        ids = g.get("image_ids") or []
        if not isinstance(ids, list) or len(ids) < 2:
            continue
        members_set = False
        for iid in ids:
            img = images_by_id.get(int(iid))
            if img is None:
                continue
            img.family_group_id = gid
            img.family_group_label = label
            members_set = True
        if members_set:
            applied.append({"id": gid, "label": label, "image_ids": ids, "color": _color_for(gid)})

    await db.commit()
    return {"applied": applied, "count": len(applied)}


@router.patch("/family-groups/image/{image_id}")
async def update_image_group(
    project_id: int,
    batch_id: int,
    image_id: int,
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Move one image into a different group, or make it standalone.

    Body: { group_id?: 'fg_xxx' | null, label?: '...' }
      group_id == null  →  make standalone
      group_id provided →  join (creates the group if it doesn't exist yet)
    """
    res = await db.execute(
        select(Image).join(Batch, Image.batch_id == Batch.id)
                     .where(Image.id == image_id, Batch.project_id == project_id, Batch.id == batch_id)
    )
    img = res.scalars().first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not in this batch")

    new_id = payload.get("group_id")
    new_label = (payload.get("label") or "").strip() or None
    if new_id in (None, "", "null"):
        img.family_group_id = None
        img.family_group_label = None
    else:
        img.family_group_id = str(new_id)
        if new_label:
            img.family_group_label = new_label
    await db.commit()
    return {
        "image_id": img.id,
        "family_group_id": img.family_group_id,
        "family_group_label": img.family_group_label,
        "color": _color_for(img.family_group_id) if img.family_group_id else None,
    }


@router.delete("/family-groups/{group_id}")
async def dissolve_group(
    project_id: int,
    batch_id: int,
    group_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Remove every image's membership in this group → they become standalone."""
    res = await db.execute(
        select(Image).join(Batch, Image.batch_id == Batch.id)
                     .where(Batch.project_id == project_id, Batch.id == batch_id,
                            Image.family_group_id == group_id)
    )
    members = res.scalars().all()
    for img in members:
        img.family_group_id = None
        img.family_group_label = None
    await db.commit()
    return {"dissolved": group_id, "members_released": len(members)}


# ─── Merged group tree ────────────────────────────────────────────────────
@router.get("/tree/group/{group_id}")
async def get_group_tree(
    project_id: int,
    batch_id: int,
    group_id: str,
    format: str = "d3",  # 'd3' | 'gedcomx'
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Build a deduped merged tree from every record whose image is in
    this family group."""
    _, all_images, _ = await _load_batch_data(db, project_id, batch_id)
    members = [img for img in all_images if img.family_group_id == group_id]
    if not members:
        raise HTTPException(status_code=404, detail="No images in this group")

    image_ids = [m.id for m in members]
    res = await db.execute(
        select(Record, Image).join(Image, Record.image_id == Image.id)
                             .where(Image.id.in_(image_ids))
    )
    rows = res.all()
    if not rows:
        raise HTTPException(status_code=400, detail="None of the group's images have extracted records yet")

    def _safe_json(s, default):
        try:
            return json.loads(s) if s else default
        except (json.JSONDecodeError, TypeError):
            return default

    payload = []
    for record, image in rows:
        payload.append({
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
        })

    gedcomx = tree_autobuild.build_deterministic_tree(payload)
    persons = gedcomx.get("persons") or []
    rels = gedcomx.get("relationships") or []
    label = next((img.family_group_label for img in members if img.family_group_label), "Family group")

    if format == "gedcomx":
        return {
            "gedcomx": gedcomx,
            "persons_count": len(persons),
            "relationships_count": len(rels),
            "group_id": group_id,
            "label": label,
            "image_ids": image_ids,
            "color": _color_for(group_id),
        }
    return {
        "tree": tree_service.gedcomx_to_d3(gedcomx),
        "gedcomx": gedcomx,
        "persons_count": len(persons),
        "relationships_count": len(rels),
        "group_id": group_id,
        "label": label,
        "image_ids": image_ids,
        "color": _color_for(group_id),
    }


@router.get("/tree/group/{group_id}/export.ged")
async def export_group_gedcom(
    project_id: int,
    batch_id: int,
    group_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Download the merged family tree for this group as GEDCOM 5.5."""
    payload = await get_group_tree(project_id, batch_id, group_id, "gedcomx", db, current_user)
    gedcomx = payload["gedcomx"]
    label = payload["label"]
    text = gedcomx_to_gedcom(gedcomx, submitter=f"SBL Infotech · {label}")
    safe_name = label.replace(" ", "_")
    return Response(
        content=text,
        media_type="text/x-gedcom",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.ged"'},
    )
