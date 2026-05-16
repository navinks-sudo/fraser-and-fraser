"""Per-batch automatic tree builder — deterministic + optional AI enhancement.

Fires whenever IndexGenius extraction completes for any image in a batch.

Strategy:
1. Walk every Record in the batch and assemble a GedcomX directly from the
   already-extracted persons/relations (which IndexGenius pulled per-image).
   This is deterministic — no AI dependency, always produces a result if any
   image has named persons.
2. Run _dedupe_persons to merge same-name spellings across images.
3. (Best-effort) Ask Gemini to enhance the tree by inferring additional links
   it can see across the full set. If that fails or returns empty, we keep
   the deterministic tree.

Coalesces concurrent triggers with a per-batch asyncio lock + pending flag so
bulk re-extracts don't spawn N parallel builds. Exposes get_status() for the
frontend to poll.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime

from sqlalchemy.future import select

from backend.database import async_session_maker
from backend.models import Batch, Image, Record
from backend.services.ai_service import ai_service, _backfill_scalar_relations
from backend.services.gedcomx_service import (
    _dedupe_persons,
    _make_person,
    _parent_child,
    _couple,
)

log = logging.getLogger(__name__)

# Coalescing primitives
_BUILD_LOCKS: dict[int, asyncio.Lock] = {}
_BUILD_PENDING: dict[int, bool] = {}
_BUILD_STATUS: dict[int, dict] = {}


def get_status(batch_id: int) -> dict:
    return _BUILD_STATUS.get(batch_id, {"status": "idle"})


def schedule(batch_id: int) -> None:
    asyncio.create_task(_run(batch_id))


async def _run(batch_id: int) -> None:
    lock = _BUILD_LOCKS.setdefault(batch_id, asyncio.Lock())
    if lock.locked():
        _BUILD_PENDING[batch_id] = True
        log.info("[autobuild] batch %s: already building, flagged pending", batch_id)
        return

    async with lock:
        while True:
            _BUILD_PENDING[batch_id] = False
            _BUILD_STATUS[batch_id] = {
                "status": "building",
                "started_at": datetime.utcnow().isoformat(),
                "last_error": None,
            }
            try:
                await _do_build(batch_id)
            except Exception as e:
                log.exception("[autobuild] batch %s failed", batch_id)
                cur = _BUILD_STATUS.get(batch_id, {})
                _BUILD_STATUS[batch_id] = {
                    **cur,
                    "status": "idle",
                    "last_error": str(e)[:300],
                    "finished_at": datetime.utcnow().isoformat(),
                }
            else:
                cur = _BUILD_STATUS.get(batch_id, {})
                _BUILD_STATUS[batch_id] = {
                    **cur,
                    "status": "idle",
                    "finished_at": datetime.utcnow().isoformat(),
                }
            if not _BUILD_PENDING.get(batch_id):
                break
            log.info("[autobuild] batch %s: pending flag set during build, looping", batch_id)


# ─── Deterministic builder ───────────────────────────────────────────────
def _norm_gender(g):
    if not g:
        return None
    s = str(g).strip().upper()
    if s in {"M", "MALE"}:
        return "M"
    if s in {"F", "FEMALE"}:
        return "F"
    return None


def _gender_from_relation(rel: str) -> str | None:
    """Infer gender from a relationship label like 'son', 'mother', 'daughter'."""
    if not rel:
        return None
    r = rel.lower().strip()
    male = {"father", "son", "brother", "husband", "godfather", "grandfather", "uncle", "nephew", "stepfather"}
    female = {"mother", "daughter", "sister", "wife", "godmother", "grandmother", "aunt", "niece", "stepmother", "maiden"}
    if r in male:
        return "M"
    if r in female:
        return "F"
    # 'spouse', 'child', 'parent' → unknown
    return None


def _is_parent_role(rel: str) -> bool:
    r = (rel or "").lower().strip()
    return r in {"father", "mother", "parent", "stepfather", "stepmother"}


def _is_child_role(rel: str) -> bool:
    r = (rel or "").lower().strip()
    return r in {"son", "daughter", "child", "stepson", "stepdaughter"}


def _is_spouse_role(rel: str) -> bool:
    r = (rel or "").lower().strip()
    return r in {"spouse", "husband", "wife"}


def build_deterministic_tree(records: list) -> dict:
    """Public alias — see _build_deterministic_tree."""
    return _build_deterministic_tree(records)


def _build_deterministic_tree(records: list) -> dict:
    """Construct a GedcomX tree using ONLY the AI-identified persons + relations.

    The intelligence layer (Gemini) is the single source of truth for both:
      - persons[] — every named individual
      - relations[] — every parent/spouse/sibling link

    Scalar fields (father_name, mother_name) and family_members are NOT used
    to auto-create edges — if the AI didn't put a relationship into relations[],
    it doesn't end up in the tree. The extract prompt forces relations[] to
    include EVERY family link, so this gives a clean, audit-trail-correct tree
    where every edge can be traced back to a Gemini decision.

    Same-name persons across records are collapsed by _dedupe_persons.
    """
    name_to_id: dict[str, str] = {}   # case-insensitive name → person id
    persons: list[dict] = []
    relationships: list[dict] = []
    next_id = 1
    rel_count = 0
    rel_skipped_unmatched = 0

    def upsert(name: str, *, gender=None, dob=None, dod=None, principal=False) -> str | None:
        nonlocal next_id
        clean = (name or "").strip()
        if not clean:
            return None
        key = clean.lower()
        if key in name_to_id:
            # Backfill any gender/dates we now know but didn't have before
            pid = name_to_id[key]
            p = next((x for x in persons if x["id"] == pid), None)
            if p:
                if gender and not p.get("gender"):
                    if gender == "M":
                        p["gender"] = {"type": "http://gedcomx.org/Male"}
                    elif gender == "F":
                        p["gender"] = {"type": "http://gedcomx.org/Female"}
                if dob or dod:
                    facts = p.get("facts") or []
                    have = {f.get("type") for f in facts}
                    if dob and "http://gedcomx.org/Birth" not in have:
                        facts.append({"type": "http://gedcomx.org/Birth", "date": {"original": dob}})
                    if dod and "http://gedcomx.org/Death" not in have:
                        facts.append({"type": "http://gedcomx.org/Death", "date": {"original": dod}})
                    if facts:
                        p["facts"] = facts
                if principal:
                    p["principal"] = True
            return pid
        pid = f"p{next_id}"
        next_id += 1
        dates = {}
        if dob:
            dates["http://gedcomx.org/Birth"] = dob
        if dod:
            dates["http://gedcomx.org/Death"] = dod
        persons.append(_make_person(pid, clean, principal=principal, dates=dates, gender=gender))
        name_to_id[key] = pid
        return pid

    seen_rel: set[tuple[str, str, str]] = set()
    def add_rel(a_id: str | None, b_id: str | None, kind: str) -> bool:
        nonlocal rel_count
        if not a_id or not b_id or a_id == b_id:
            return False
        if kind == "Couple":
            # Couple is symmetric — store sorted to dedupe both directions
            a, b = sorted([a_id, b_id])
            key = (a, b, kind)
            if key in seen_rel:
                return False
            seen_rel.add(key)
            relationships.append(_couple(a, b))
        else:
            key = (a_id, b_id, kind)
            if key in seen_rel:
                return False
            seen_rel.add(key)
            relationships.append(_parent_child(a_id, b_id))
        rel_count += 1
        return True

    # ── Pass 1: register every AI-identified person, indexed by name
    for rec in records:
        for p in rec.get("persons") or []:
            if not isinstance(p, dict):
                continue
            nm = (p.get("name") or "").strip()
            if not nm:
                continue
            role = (p.get("role") or "").strip().lower()
            upsert(
                nm,
                gender=_norm_gender(p.get("gender")),
                dob=p.get("date_of_birth"),
                dod=p.get("date_of_death"),
                principal=(role == "subject"),
            )

    # ── Pass 2: apply ONLY the AI-identified relations
    # Track which persons end up connected — only those land in the final tree.
    connected_ids: set[str] = set()

    # Fuzzy fallback for relation lookups. The AI sometimes writes a relation
    # against a slightly different spelling than the persons[] entry (e.g.
    # "Roger Morkowski" vs the canonical "Roger Albert Morkowski"). We try:
    #   1. exact case-insensitive match
    #   2. substring either direction
    #   3. token-subset match (every token of the query appears in the candidate)
    import re as _re
    def _fuzzy_lookup(query: str) -> str | None:
        if not query:
            return None
        q = query.strip().lower()
        if q in name_to_id:
            return name_to_id[q]
        # Substring either direction
        for key, pid in name_to_id.items():
            if q in key or key in q:
                return pid
        # Token-subset
        q_tokens = {t for t in _re.split(r"\s+", q) if t}
        if not q_tokens:
            return None
        for key, pid in name_to_id.items():
            p_tokens = set(_re.split(r"\s+", key))
            if q_tokens.issubset(p_tokens) or p_tokens.issubset(q_tokens):
                return pid
        return None

    for rec in records:
        for r in rec.get("relations") or []:
            if not isinstance(r, dict):
                continue
            a_name = (r.get("person_a") or "").strip()
            b_name = (r.get("person_b") or "").strip()
            t = (r.get("type") or "").strip().lower()
            if not a_name or not b_name or not t:
                continue
            a_id = _fuzzy_lookup(a_name)
            b_id = _fuzzy_lookup(b_name)
            if not a_id or not b_id:
                # Person referenced in relations[] but never declared in persons[].
                # The AI is meant to keep these consistent — log and skip.
                rel_skipped_unmatched += 1
                log.debug(
                    "[autobuild] skipping relation with unmatched name: %r→%r (%s)",
                    a_name, b_name, t,
                )
                continue
            edge_added = False
            if t in {"parent_of", "is_parent_of", "father_of", "mother_of"}:
                edge_added = add_rel(a_id, b_id, "ParentChild")
            elif t in {"child_of", "is_child_of", "son_of", "daughter_of"}:
                edge_added = add_rel(b_id, a_id, "ParentChild")
            elif t in {"spouse_of", "married_to", "couple", "husband_of", "wife_of"}:
                edge_added = add_rel(a_id, b_id, "Couple")
            # sibling_of / godparent_of / witness_of / other — intentionally
            # excluded from the tree structure (they don't define parent/spouse edges)
            if edge_added:
                connected_ids.add(a_id)
                connected_ids.add(b_id)

    # ── Family-only filter: drop persons who don't participate in any
    # parent/spouse relationship. Doctors, registrars, witnesses, informants
    # (who aren't also relatives) get pruned here. The tree should be the
    # FAMILY, not the cast of bureaucrats who signed the certificate.
    dropped = len(persons) - len(connected_ids)
    persons = [p for p in persons if p["id"] in connected_ids]

    log.info(
        "[autobuild] tree from AI relations: %d persons in tree, %d edges, "
        "%d non-family persons pruned, %d unmatched-name relations skipped",
        len(persons), rel_count, dropped, rel_skipped_unmatched,
    )

    # Collapse same-name duplicates with token-subset fuzzy match
    merged_persons, merged_rels = _dedupe_persons(persons, relationships)
    return {"persons": merged_persons, "relationships": merged_rels}


async def _do_build(batch_id: int) -> None:
    async with async_session_maker() as db:
        res = await db.execute(
            select(Record, Image)
            .join(Image, Record.image_id == Image.id)
            .where(Image.batch_id == batch_id)
        )
        rows = res.all()
        if not rows:
            log.info("[autobuild] batch %s: no records yet — skipping", batch_id)
            return

        # ── Normalisation pass: run the scalar-fields backfill on every
        # record's stored extraction. This ensures records that were
        # extracted BEFORE the safety-net was added (or where the AI
        # forgot relations) get their relations populated NOW, without
        # needing to re-run the AI. Persists the new persons/relations
        # back to the DB so the ImageViewer reflects them too.
        normalised_count = 0
        records_payload = []
        for record, image in rows:
            try:
                persons_arr = json.loads(record.persons_extracted) if record.persons_extracted else []
            except (json.JSONDecodeError, TypeError):
                persons_arr = []
            try:
                relations_arr = json.loads(record.relations_extracted) if record.relations_extracted else []
            except (json.JSONDecodeError, TypeError):
                relations_arr = []
            try:
                family_arr = json.loads(record.family_members) if record.family_members else []
            except (json.JSONDecodeError, TypeError):
                family_arr = []
            # Defensive: stored JSON should be a list — coerce anything else.
            if not isinstance(persons_arr, list):
                persons_arr = []
            if not isinstance(relations_arr, list):
                relations_arr = []
            if not isinstance(family_arr, list):
                family_arr = []
            # Strip non-dict entries (a malformed stored row could leak strings)
            persons_arr = [p for p in persons_arr if isinstance(p, dict)]
            relations_arr = [r for r in relations_arr if isinstance(r, dict)]
            family_arr = [f for f in family_arr if isinstance(f, dict)]

            # Reconstruct an extraction dict that matches what _backfill_scalar_relations expects
            extraction = {
                "given_name": record.given_name,
                "surname": record.surname,
                "father_name": record.father_name,
                "mother_name": record.mother_name,
                "family_members": family_arr,
                "persons": list(persons_arr),
                "relations": list(relations_arr),
            }
            before_persons = len(extraction["persons"])
            before_rels = len(extraction["relations"])
            extraction = _backfill_scalar_relations(extraction)
            after_persons = len(extraction["persons"])
            after_rels = len(extraction["relations"])

            if after_persons != before_persons or after_rels != before_rels:
                # Persist the backfilled data
                record.persons_extracted = json.dumps(extraction["persons"])
                record.relations_extracted = json.dumps(extraction["relations"])
                normalised_count += 1
                log.info(
                    "[autobuild] batch %s, image %s: backfilled %d→%d persons, %d→%d relations",
                    batch_id, record.image_id, before_persons, after_persons, before_rels, after_rels,
                )

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
                "family_members": family_arr,
                "persons": extraction["persons"],
                "relations": extraction["relations"],
            })

        if normalised_count:
            await db.commit()
            log.info("[autobuild] batch %s: normalised %d record(s) before tree build", batch_id, normalised_count)

        # ── Step 1: Always build the deterministic tree first. This guarantees
        # we get a usable tree from whatever the extractor already found.
        det = _build_deterministic_tree(records_payload)
        det_persons = det.get("persons") or []
        det_rels = det.get("relationships") or []
        log.info(
            "[autobuild] batch %s: deterministic build: %d persons, %d relations",
            batch_id, len(det_persons), len(det_rels),
        )

        # ── Step 2: Try AI enhancement on top (best-effort).
        final = det
        if det_persons and ai_service.is_configured:
            try:
                ai_tree = await ai_service.build_family_tree(records_payload)
                ai_persons = ai_tree.get("persons") or []
                ai_rels = ai_tree.get("relationships") or []
                log.info(
                    "[autobuild] batch %s: AI build returned %d persons, %d relations",
                    batch_id, len(ai_persons), len(ai_rels),
                )
                # Prefer the AI tree only if it actually has more signal than the
                # deterministic one. Otherwise the deterministic tree wins.
                if len(ai_persons) >= len(det_persons) and len(ai_rels) >= len(det_rels):
                    final = ai_tree
                    log.info("[autobuild] batch %s: using AI-enhanced tree", batch_id)
                else:
                    log.info("[autobuild] batch %s: AI tree weaker than deterministic — keeping deterministic", batch_id)
            except Exception as e:
                log.warning("[autobuild] batch %s: AI build failed (%s) — keeping deterministic tree", batch_id, e)

        persons = final.get("persons") or []
        rels = final.get("relationships") or []

        res = await db.execute(select(Batch).where(Batch.id == batch_id))
        batch = res.scalars().first()
        if not batch:
            log.warning("[autobuild] batch %s vanished mid-build", batch_id)
            return

        batch.tree_data = json.dumps(final, ensure_ascii=False)
        batch.tree_persons_count = len(persons)
        batch.tree_relationships_count = len(rels)
        batch.tree_built_at = datetime.utcnow()
        await db.commit()

        cur = _BUILD_STATUS.get(batch_id, {})
        _BUILD_STATUS[batch_id] = {
            **cur,
            "persons_count": len(persons),
            "relationships_count": len(rels),
            "last_built_at": batch.tree_built_at.isoformat(),
        }
        log.info(
            "[autobuild] batch %s: tree saved with %d persons, %d relations",
            batch_id, len(persons), len(rels),
        )
