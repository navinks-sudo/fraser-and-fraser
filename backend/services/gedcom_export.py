"""Serialise a GedcomX-style dict into a GEDCOM 5.5 text file.

GEDCOM is the lingua franca that Family Tree Maker, Gramps, Ancestry,
MyHeritage, FamilySearch and basically every other genealogy product reads.
"""
from datetime import datetime


def _line(level: int, tag: str, value: str = "") -> str:
    return f"{level} {tag}" + (f" {value}" if value else "") + "\n"


def _split_name(full_text: str) -> tuple[str, str]:
    """Split into 'given' and 'surname' for GEDCOM's NAME tag."""
    if not full_text:
        return "", ""
    parts = full_text.strip().rsplit(" ", 1)
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]


def _gender_for(person: dict) -> str:
    t = (person.get("gender") or {}).get("type") if isinstance(person.get("gender"), dict) else ""
    if (t or "").endswith("Male"):
        return "M"
    if (t or "").endswith("Female"):
        return "F"
    return "U"


def gedcomx_to_gedcom(gedcomx: dict, *, submitter: str = "GenealogIQ") -> str:
    """Convert GedcomX dict → GEDCOM 5.5 text."""
    persons = gedcomx.get("persons") or []
    rels = gedcomx.get("relationships") or []

    # Map person ids to GEDCOM INDI cross-references
    indi_xref = {p["id"]: f"@I{i+1}@" for i, p in enumerate(persons)}

    # Build family groups: each Couple becomes a family; ParentChild edges add members
    # First, identify couples
    couples = []  # list of (person1_id, person2_id)
    couple_set = set()
    for r in rels:
        t = (r.get("type") or "").rsplit("/", 1)[-1]
        a = (r.get("person1") or {}).get("resource", "").lstrip("#")
        b = (r.get("person2") or {}).get("resource", "").lstrip("#")
        if t == "Couple" and a and b:
            key = tuple(sorted([a, b]))
            if key not in couple_set:
                couple_set.add(key)
                couples.append((a, b))

    # Build parents-of-child map from ParentChild edges
    parents_of = {}
    children_of = {}
    for r in rels:
        t = (r.get("type") or "").rsplit("/", 1)[-1]
        a = (r.get("person1") or {}).get("resource", "").lstrip("#")
        b = (r.get("person2") or {}).get("resource", "").lstrip("#")
        if t == "ParentChild" and a and b:
            parents_of.setdefault(b, set()).add(a)
            children_of.setdefault(a, set()).add(b)

    # Family records: one per couple-with-children, plus one for orphan parent-child groups
    families = []  # each: {husband, wife, children: []}
    used_as_parent = set()

    for a, b in couples:
        # Decide husband/wife by gender
        ga = _gender_for(next((p for p in persons if p["id"] == a), {}))
        gb = _gender_for(next((p for p in persons if p["id"] == b), {}))
        husband, wife = (a, b) if (ga == "M" or gb == "F") and not (gb == "M" and ga == "F") else (b, a) if gb == "M" else (a, b)
        # Shared children
        kids_a = children_of.get(a, set())
        kids_b = children_of.get(b, set())
        shared = sorted(kids_a & kids_b)
        families.append({"husband": husband, "wife": wife, "children": shared})
        used_as_parent.update([a, b])

    # Single-parent groups for parents not yet in a family
    for pid, kids in children_of.items():
        if pid in used_as_parent:
            continue
        new_kids = [k for k in kids if not any(k in f["children"] for f in families)]
        if not new_kids:
            continue
        gender = _gender_for(next((p for p in persons if p["id"] == pid), {}))
        fam = {"husband": pid if gender == "M" else None, "wife": pid if gender == "F" else None, "children": sorted(new_kids)}
        if gender == "U":
            fam["husband"] = pid
        families.append(fam)
        used_as_parent.add(pid)

    fam_xref = {i: f"@F{i+1}@" for i in range(len(families))}

    out = []
    # Header
    out.append(_line(0, "HEAD"))
    out.append(_line(1, "SOUR", submitter))
    out.append(_line(2, "NAME", "GenealogIQ Genealogy Pipeline"))
    out.append(_line(2, "VERS", "1.0"))
    out.append(_line(1, "DATE", datetime.utcnow().strftime("%d %b %Y").upper()))
    out.append(_line(1, "GEDC"))
    out.append(_line(2, "VERS", "5.5.1"))
    out.append(_line(2, "FORM", "LINEAGE-LINKED"))
    out.append(_line(1, "CHAR", "UTF-8"))
    out.append(_line(1, "SUBM", "@SUBM@"))

    # Submitter
    out.append(_line(0, "@SUBM@", "SUBM"))
    out.append(_line(1, "NAME", submitter))

    # Persons
    for p in persons:
        xref = indi_xref[p["id"]]
        out.append(_line(0, xref, "INDI"))
        full_name = ((p.get("names") or [{}])[0].get("nameForms") or [{}])[0].get("fullText", "")
        given, surname = _split_name(full_name)
        out.append(_line(1, "NAME", f"{given} /{surname}/" if surname else given))
        if given:
            out.append(_line(2, "GIVN", given))
        if surname:
            out.append(_line(2, "SURN", surname))
        gender = _gender_for(p)
        out.append(_line(1, "SEX", gender if gender in ("M", "F") else "U"))

        # Birth / Death facts
        for fact in p.get("facts") or []:
            ftype = (fact.get("type") or "").rsplit("/", 1)[-1].upper()
            tag = {"BIRTH": "BIRT", "DEATH": "DEAT", "BAPTISM": "BAPM", "BURIAL": "BURI", "MARRIAGE": "MARR"}.get(ftype)
            if not tag:
                continue
            out.append(_line(1, tag))
            date = (fact.get("date") or {}).get("original")
            place = (fact.get("place") or {}).get("original")
            if date:
                out.append(_line(2, "DATE", date))
            if place:
                out.append(_line(2, "PLAC", place))

        # FAMC / FAMS cross-refs
        for i, fam in enumerate(families):
            if fam.get("husband") == p["id"] or fam.get("wife") == p["id"]:
                out.append(_line(1, "FAMS", fam_xref[i]))
            if p["id"] in fam.get("children") or []:
                out.append(_line(1, "FAMC", fam_xref[i]))

    # Families
    for i, fam in enumerate(families):
        out.append(_line(0, fam_xref[i], "FAM"))
        if fam.get("husband"):
            out.append(_line(1, "HUSB", indi_xref[fam["husband"]]))
        if fam.get("wife"):
            out.append(_line(1, "WIFE", indi_xref[fam["wife"]]))
        for cid in fam.get("children") or []:
            if cid in indi_xref:
                out.append(_line(1, "CHIL", indi_xref[cid]))

    # Trailer
    out.append(_line(0, "TRLR"))
    return "".join(out)
