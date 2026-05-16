"""Auto-detect which certificates in a batch belong to the same family.

Algorithm:
1. For every image in the batch, gather its extracted person names.
2. Compute pairwise name-overlap between images using token-subset matching
   (the same fuzzy matcher used to dedupe persons inside a single tree).
3. A pair is considered "related" if the overlap score crosses a threshold.
4. Build a graph where nodes = images and edges = related pairs; the
   connected components are the suggested family groups.

Threshold is deliberately conservative — a single common first name is
not enough; we need either one full-name match or two partial matches.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Iterable

log = logging.getLogger(__name__)


# ─── Name normalisation ───────────────────────────────────────────────────
_STOPWORDS = {
    "of", "the", "and", "de", "del", "da", "von", "van", "le", "la", "di",
    "jr", "sr", "ii", "iii", "iv", "mrs", "mr", "miss", "ms", "dr",
    "fr", "rev", "father", "mother", "son", "daughter",
    "unknown", "none", "n/a",
}


def _tokens(name: str) -> set[str]:
    """Lowercase alpha tokens with length ≥ 2, stopwords removed."""
    if not name:
        return set()
    # Strip parenthesised suffixes like "(formerly Allsop)"
    cleaned = re.sub(r"\s*\([^)]*\)\s*", " ", name)
    # Strip "née ..." / "formerly ..." trailers
    cleaned = re.sub(r"\s+(?:formerly|née|nee|maiden)\s+\S+.*$", "", cleaned, flags=re.IGNORECASE)
    parts = re.split(r"[^A-Za-zÀ-ÿ']+", cleaned.lower())
    return {p for p in parts if len(p) >= 2 and p not in _STOPWORDS}


def _name_score(a: str, b: str) -> float:
    """Similarity 0..1 between two names by token-subset overlap.
    1.0 = identical token sets. 0.5+ = strong match. <0.5 = weak."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    if ta == tb:
        return 1.0
    common = ta & tb
    if not common:
        return 0.0
    # Jaccard, but boosted if one is a subset of the other
    smaller = min(len(ta), len(tb))
    if len(common) == smaller:
        return 0.75 + 0.25 * (smaller / max(len(ta), len(tb)))
    return len(common) / len(ta | tb)


# Roles that are bureaucratic — these names should NOT contribute to whether
# two certificates "belong to the same family". A registrar who signs a
# Smith death cert and a Jones birth cert doesn't mean those two families
# are related. Same for the family doctor, the witness, the priest, etc.
_NON_FAMILY_ROLES = {
    "doctor", "physician", "registrar", "witness", "officiant",
    "priest", "minister", "celebrant", "clerk", "official",
    "godparent", "godfather", "godmother",
    "informant",   # only counts as family if explicitly tagged son/daughter/spouse
    "other",
}


def _extract_person_names(record_row) -> list[str]:
    """Pull every FAMILY-relevant person name we know about for this image.

    Excludes bureaucratic roles (doctors, registrars, witnesses, godparents,
    informants without family context) so they don't trigger false matches
    between unrelated families.
    """
    names: list[str] = []
    if record_row is None:
        return names
    try:
        persons = json.loads(record_row.persons_extracted or "[]")
    except (json.JSONDecodeError, TypeError):
        persons = []
    if isinstance(persons, list):
        for p in persons:
            if not isinstance(p, dict):
                continue
            nm = (p.get("name") or "").strip()
            if not nm:
                continue
            role = (p.get("role") or "").strip().lower()
            if role in _NON_FAMILY_ROLES:
                continue
            names.append(nm)
    for scalar in ("father_name", "mother_name"):
        v = getattr(record_row, scalar, None)
        if v and isinstance(v, str) and v.strip():
            names.append(v.strip())
    full = " ".join(
        filter(None, [(record_row.given_name or "").strip(), (record_row.surname or "").strip()])
    ).strip()
    if full:
        names.append(full)
    return names


def _pair_score(names_a: list[str], names_b: list[str]) -> tuple[float, list[tuple[str, str, float]]]:
    """Compute the overall affinity score between two images' name sets,
    plus the matched name pairs that drove the decision.

    Returns (score, [(name_a, name_b, similarity), ...])
    """
    matches: list[tuple[str, str, float]] = []
    used_b: set[int] = set()
    for na in names_a:
        best_b_idx = -1
        best_s = 0.0
        for j, nb in enumerate(names_b):
            if j in used_b:
                continue
            s = _name_score(na, nb)
            if s > best_s:
                best_s = s
                best_b_idx = j
        if best_b_idx >= 0 and best_s >= 0.5:
            matches.append((na, names_b[best_b_idx], best_s))
            used_b.add(best_b_idx)

    if not matches:
        return 0.0, []

    # Score: weight strong matches more. One full-name (>=0.85) is enough;
    # otherwise need 2+ partial matches.
    strong = [m for m in matches if m[2] >= 0.85]
    medium = [m for m in matches if 0.5 <= m[2] < 0.85]
    if strong:
        total = sum(m[2] for m in matches) + 0.5 * len(strong)
    elif len(medium) >= 2:
        total = sum(m[2] for m in matches)
    else:
        return 0.0, []
    return total, matches


# Affinity threshold above which two images are considered related.
# Tuned so:
#  - one full-name match (score ~1.5 with strong-bonus) → pass
#  - two partial matches (sum ~1.2) → pass
#  - one partial match alone (~0.6) → fail
_THRESHOLD = 1.0


# ─── Suggestion API ──────────────────────────────────────────────────────
def suggest_groups(records_by_image_id: dict[int, "Record"], images: list["Image"]) -> dict:
    """Compute suggested family groupings for a batch.

    Args:
        records_by_image_id: image_id -> Record (or None if not extracted yet)
        images: list of Image rows in the batch

    Returns:
        {
          "groups": [
            {
              "suggested_id": "fg_xxx",          # provisional id; final on apply
              "label": "Clifford family",
              "image_ids": [3, 7, 11],
              "shared_names": ["Roy Clifford", "Patricia Williams"],
              "score": 4.2,
            },
            ...
          ],
          "standalones": [4, 5, 6, 8, ...],
        }
    """
    # Gather per-image name lists once
    names: dict[int, list[str]] = {}
    for img in images:
        rec = records_by_image_id.get(img.id)
        names[img.id] = _extract_person_names(rec)

    # Build edges between every image-pair that crosses the threshold
    ids = [img.id for img in images]
    edges: list[tuple[int, int, float, list]] = []  # (a, b, score, matches)
    for i, a in enumerate(ids):
        if not names[a]:
            continue
        for b in ids[i + 1:]:
            if not names[b]:
                continue
            score, matches = _pair_score(names[a], names[b])
            if score >= _THRESHOLD:
                edges.append((a, b, score, matches))

    # Union-find connected components
    parent: dict[int, int] = {i: i for i in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[rx] = ry

    for a, b, _, _ in edges:
        union(a, b)

    # Group images by their root
    components: dict[int, list[int]] = {}
    for i in ids:
        components.setdefault(find(i), []).append(i)

    # Pick out groups with ≥2 members; the rest are standalones
    groups: list[dict] = []
    standalones: list[int] = []
    for root, members in components.items():
        if len(members) < 2:
            standalones.append(members[0])
            continue
        member_set = set(members)
        member_edges = [e for e in edges if e[0] in member_set and e[1] in member_set]
        shared = _shared_names_summary(member_edges)
        label = _label_from_shared(shared)
        groups.append({
            "suggested_id": f"fg_{uuid.uuid4().hex[:10]}",
            "label": label,
            "image_ids": sorted(members),
            "shared_names": shared[:5],
            "score": round(sum(e[2] for e in member_edges), 2),
        })

    # Stable ordering: biggest groups first, then by sorted ids
    groups.sort(key=lambda g: (-len(g["image_ids"]), g["image_ids"][0]))
    return {"groups": groups, "standalones": sorted(standalones)}


def _shared_names_summary(member_edges) -> list[str]:
    """Pick the most-frequently-mentioned shared names across the group's
    matched pairs, so the UI can show 'shares: Roy Clifford, Patricia Williams'."""
    from collections import Counter
    bag: Counter[str] = Counter()
    for _, _, _, matches in member_edges:
        for na, nb, _ in matches:
            # Use the longer of the two as the canonical form
            canon = na if len(na) >= len(nb) else nb
            bag[canon] += 1
    return [name for name, _ in bag.most_common(10)]


def _label_from_shared(shared_names: Iterable[str]) -> str:
    """Derive a human-friendly group label from the shared names."""
    # Take the most common surname (last token of the most frequent shared name)
    if not shared_names:
        return "Family group"
    first_name = next(iter(shared_names), "")
    tokens = first_name.strip().split()
    surname = tokens[-1] if tokens else ""
    if surname and surname.lower() not in _STOPWORDS:
        return f"{surname} family"
    return "Family group"
