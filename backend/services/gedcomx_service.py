import re
from typing import Optional, Tuple


_PARENT_RE = re.compile(
    r"(?:fils|fille|enfant|son|daughter|child)\s+(?:de|of)\s+(.+?)\s+(?:et(?:\s+de)?|and)\s+(.+)",
    re.IGNORECASE,
)

_MALE_KEYWORDS = (
    "fils", "father", "son", "husband", "père", "pere", "mari", "époux", "epoux",
    "frère", "frere", "brother", "grandfather", "grandpère", "grandpere",
)
_FEMALE_KEYWORDS = (
    "fille", "mother", "daughter", "wife", "mère", "mere", "femme", "épouse", "epouse",
    "sœur", "soeur", "sister", "grandmother", "grandmère", "grandmere",
)


def _gender_from_role(role: Optional[str]) -> Optional[str]:
    if not role:
        return None
    rl = role.lower()
    # Female first — "fille" contains "fil" so "fils" check would also need care, but exact tokens differ.
    for kw in _FEMALE_KEYWORDS:
        if re.search(rf"\b{re.escape(kw)}\b", rl):
            return "F"
    for kw in _MALE_KEYWORDS:
        if re.search(rf"\b{re.escape(kw)}\b", rl):
            return "M"
    return None


def _parse_parents_from_relation(relation: str) -> Tuple[Optional[str], Optional[str]]:
    if not relation:
        return None, None
    m = _PARENT_RE.search(relation)
    if not m:
        return None, None
    return m.group(1).strip().rstrip(",.;"), m.group(2).strip().rstrip(",.;")


def _name_of(p: dict) -> str:
    for n in p.get("names") or []:
        for nf in n.get("nameForms") or []:
            if nf.get("fullText"):
                return nf["fullText"]
    return p.get("id") or ""


def _gender_letter(p: dict) -> Optional[str]:
    t = (p.get("gender") or {}).get("type", "") if isinstance(p.get("gender"), dict) else ""
    if t.endswith("Male"):
        return "M"
    if t.endswith("Female"):
        return "F"
    return None


def _dedupe_persons(persons: list, relationships: list) -> tuple[list, list]:
    """Merge persons whose names are token-subsets of one another.

    e.g. "Frank" and "Frank Boul" → keep "Frank Boul". Genders must be
    compatible (one unknown OR same). All relationship references are
    rewired and self-loops + duplicates collapsed.
    """
    if not persons:
        return persons, relationships

    # Process longer names first so they win as the canonical form.
    by_length = sorted(persons, key=lambda p: -len(_name_of(p)))
    canonical: dict[str, dict] = {}
    redirects: dict[str, str] = {}

    for p in by_length:
        p_name = _name_of(p).strip()
        if not p_name:
            continue
        p_tokens = set(p_name.lower().split())
        p_gender = _gender_letter(p)
        merged_into = None
        for canon in canonical.values():
            c_name = _name_of(canon)
            c_tokens = set(c_name.lower().split())
            c_gender = _gender_letter(canon)

            # Token-subset on either side → likely the same person
            subset = p_tokens.issubset(c_tokens) or c_tokens.issubset(p_tokens)
            if not subset:
                continue
            # Gender compatibility: one unknown OR same
            if p_gender and c_gender and p_gender != c_gender:
                continue
            # Merge: fill in missing fields on the canonical
            if not c_gender and p_gender:
                canon["gender"] = p["gender"]
            for key in ("facts", "principal"):
                if not canon.get(key) and p.get(key):
                    canon[key] = p[key]
            merged_into = canon
            break

        if merged_into is None:
            canonical[p["id"]] = p
        else:
            redirects[p["id"]] = merged_into["id"]

    # Rewire relationships, drop self-loops and duplicates
    new_rels: list = []
    seen: set = set()
    for r in relationships:
        a = (r.get("person1") or {}).get("resource", "").lstrip("#")
        b = (r.get("person2") or {}).get("resource", "").lstrip("#")
        a = redirects.get(a, a)
        b = redirects.get(b, b)
        if not a or not b or a == b:
            continue
        r["person1"] = {"resource": f"#{a}"}
        r["person2"] = {"resource": f"#{b}"}
        t = r.get("type", "")
        key = (t, a, b)
        rev = (t, b, a) if t.endswith("Couple") else None
        if key in seen or (rev and rev in seen):
            continue
        seen.add(key)
        new_rels.append(r)

    return list(canonical.values()), new_rels


def _make_person(
    person_id: str,
    name: str,
    principal: bool = False,
    dates: Optional[dict] = None,
    gender: Optional[str] = None,
) -> dict:
    p = {
        "id": person_id,
        "names": [{"nameForms": [{"fullText": (name or "Unknown").strip()}]}],
    }
    if principal:
        p["principal"] = True
    if gender == "M":
        p["gender"] = {"type": "http://gedcomx.org/Male"}
    elif gender == "F":
        p["gender"] = {"type": "http://gedcomx.org/Female"}
    facts = []
    for fact_type, value in (dates or {}).items():
        if value:
            facts.append({"type": fact_type, "date": {"original": value}})
    if facts:
        p["facts"] = facts
    return p


def _parent_child(parent_id: str, child_id: str) -> dict:
    return {
        "type": "http://gedcomx.org/ParentChild",
        "person1": {"resource": f"#{parent_id}"},
        "person2": {"resource": f"#{child_id}"},
    }


def _couple(a_id: str, b_id: str) -> dict:
    return {
        "type": "http://gedcomx.org/Couple",
        "person1": {"resource": f"#{a_id}"},
        "person2": {"resource": f"#{b_id}"},
    }


class GedcomXService:
    async def generate_gedcomx(self, record_data: dict) -> dict:
        """Build a GedcomX document deterministically from extracted record data."""
        persons: list = []
        relationships: list = []
        person_id_by_name: dict = {}
        person_index_by_id: dict = {}
        counter = [0]

        def set_gender(pid: str, gender: Optional[str]) -> None:
            if not gender or pid not in person_index_by_id:
                return
            person = person_index_by_id[pid]
            if "gender" not in person:
                person["gender"] = {
                    "type": "http://gedcomx.org/Male" if gender == "M" else "http://gedcomx.org/Female"
                }

        def get_or_create(
            name: Optional[str],
            principal: bool = False,
            dates: Optional[dict] = None,
            gender: Optional[str] = None,
        ) -> Optional[str]:
            if not name or not str(name).strip():
                return None
            key = str(name).strip().lower()
            if key in person_id_by_name:
                pid = person_id_by_name[key]
                set_gender(pid, gender)
                return pid
            counter[0] += 1
            pid = f"p{counter[0]}"
            person = _make_person(pid, name, principal=principal, dates=dates, gender=gender)
            persons.append(person)
            person_index_by_id[pid] = person
            person_id_by_name[key] = pid
            return pid

        # Subject
        subject_full = " ".join(
            s for s in [record_data.get("given_name"), record_data.get("surname")] if s
        ).strip()

        subject_dates = {
            "http://gedcomx.org/Birth": record_data.get("date_of_birth"),
            "http://gedcomx.org/Death": record_data.get("date_of_death"),
        }
        event_type = record_data.get("event_type")
        if event_type and record_data.get("date_of_event"):
            subject_dates[f"http://gedcomx.org/{str(event_type).title()}"] = record_data.get("date_of_event")
        subject_dates = {k: v for k, v in subject_dates.items() if v}

        subject_id = None
        if subject_full or subject_dates:
            subject_id = get_or_create(subject_full or "Subject", principal=True, dates=subject_dates or None)

        father_id = get_or_create(record_data.get("father_name"), gender="M")
        mother_id = get_or_create(record_data.get("mother_name"), gender="F")
        if father_id and subject_id:
            relationships.append(_parent_child(father_id, subject_id))
        if mother_id and subject_id:
            relationships.append(_parent_child(mother_id, subject_id))
        if father_id and mother_id:
            relationships.append(_couple(father_id, mother_id))

        for fm in record_data.get("family_members") or []:
            fm_name = (fm.get("name") or "").strip() if isinstance(fm, dict) else ""
            fm_relation = (fm.get("relation") or "").strip() if isinstance(fm, dict) else ""
            fm_gender = _gender_from_role(fm_relation)

            fm_id = get_or_create(fm_name, gender=fm_gender) if fm_name else None

            fp1, fp2 = _parse_parents_from_relation(fm_relation)
            if fp1 or fp2:
                # Convention: first parent in "X et Y" / "X and Y" is the father.
                p1_id = get_or_create(fp1, gender="M") if fp1 else None
                p2_id = get_or_create(fp2, gender="F") if fp2 else None
                if fm_id and p1_id:
                    relationships.append(_parent_child(p1_id, fm_id))
                if fm_id and p2_id:
                    relationships.append(_parent_child(p2_id, fm_id))
                if p1_id and p2_id:
                    relationships.append(_couple(p1_id, p2_id))
            else:
                rel_lower = fm_relation.lower()
                if subject_id and fm_id:
                    if any(k in rel_lower for k in ("father", "père", "pere", "parent")):
                        set_gender(fm_id, "M")
                        relationships.append(_parent_child(fm_id, subject_id))
                    elif any(k in rel_lower for k in ("mother", "mère", "mere")):
                        set_gender(fm_id, "F")
                        relationships.append(_parent_child(fm_id, subject_id))
                    elif any(k in rel_lower for k in ("son", "fils")):
                        set_gender(fm_id, "M")
                        relationships.append(_parent_child(subject_id, fm_id))
                    elif any(k in rel_lower for k in ("daughter", "fille")):
                        set_gender(fm_id, "F")
                        relationships.append(_parent_child(subject_id, fm_id))
                    elif any(k in rel_lower for k in ("husband", "mari", "époux", "epoux")):
                        set_gender(fm_id, "M")
                        relationships.append(_couple(subject_id, fm_id))
                    elif any(k in rel_lower for k in ("wife", "épouse", "epouse", "femme")):
                        set_gender(fm_id, "F")
                        relationships.append(_couple(subject_id, fm_id))
                    elif any(k in rel_lower for k in ("spouse",)):
                        relationships.append(_couple(subject_id, fm_id))

        seen = set()
        deduped = []
        for r in relationships:
            a = r["person1"]["resource"]
            b = r["person2"]["resource"]
            t = r["type"]
            key = (t, a, b)
            rev = (t, b, a) if t.endswith("Couple") else None
            if key in seen or (rev and rev in seen):
                continue
            seen.add(key)
            deduped.append(r)

        # Final pass: merge people whose names are token-subsets of one another
        # (e.g. "Joelty" and "Joelty Boul"). Rewires relationships accordingly.
        merged_persons, merged_rels = _dedupe_persons(persons, deduped)
        return {"persons": merged_persons, "relationships": merged_rels}
