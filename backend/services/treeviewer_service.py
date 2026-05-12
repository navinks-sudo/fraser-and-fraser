class TreeViewerService:
    def gedcomx_to_d3(self, gedcomx: dict) -> dict:
        """Render every family in a GedcomX document as a forest under a synthetic root.

        Each Couple-with-shared-children becomes a family node labeled
        "{ParentA} & {ParentB}" with the shared children as its leaves.
        Single-parent groups and unrelated persons are surfaced too. The
        principal (if any) is tagged with ``type: Primary`` so the frontend
        can highlight them.
        """
        persons = gedcomx.get("persons") or []
        relationships = gedcomx.get("relationships") or []

        if not persons:
            return {"name": "No data", "attributes": {"id": "none"}, "children": []}

        by_id = {p["id"]: p for p in persons if p.get("id")}
        children_of: dict = {}
        parents_of: dict = {}
        couples: list = []
        seen_couples: set = set()

        for rel in relationships:
            rel_type = (rel.get("type") or "").rsplit("/", 1)[-1]
            a = (rel.get("person1") or {}).get("resource", "").lstrip("#")
            b = (rel.get("person2") or {}).get("resource", "").lstrip("#")
            if not a or not b:
                continue
            if rel_type == "ParentChild":
                children_of.setdefault(a, []).append(b)
                parents_of.setdefault(b, []).append(a)
            elif rel_type == "Couple":
                key = frozenset((a, b))
                if key not in seen_couples:
                    seen_couples.add(key)
                    couples.append((a, b))

        principal_id = next((p.get("id") for p in persons if p.get("principal")), None)

        def name_of(person):
            for n in person.get("names") or []:
                for nf in n.get("nameForms") or []:
                    txt = nf.get("fullText")
                    if txt:
                        return txt
            return person.get("id") or "Unknown"

        def gender_of(person):
            t = ((person.get("gender") or {}).get("type") or "")
            if t.endswith("Male"):
                return "M"
            if t.endswith("Female"):
                return "F"
            return "U"

        def make_node(person, relation_label=None, type_override=None):
            attrs = {"id": person.get("id"), "gender": gender_of(person)}
            if relation_label:
                attrs["relation"] = relation_label
            if type_override:
                attrs["type"] = type_override
            elif person.get("id") == principal_id:
                attrs["type"] = "Primary"
            return {"name": name_of(person), "attributes": attrs, "children": []}

        used_as_parent: set = set()
        used_as_child: set = set()
        families: list = []

        # 1) Couple families (parents with shared children)
        for a, b in couples:
            shared = sorted(set(children_of.get(a, [])) & set(children_of.get(b, [])))
            if not shared:
                continue
            father = by_id.get(a)
            mother = by_id.get(b)
            if not father or not mother:
                continue
            family_name = f"{name_of(father)} & {name_of(mother)}"
            family_node = {
                "name": family_name,
                "attributes": {
                    "id": f"family-{a}-{b}",
                    "type": "Family",
                    "fatherName": name_of(father),
                    "motherName": name_of(mother),
                    "fatherGender": gender_of(father),
                    "motherGender": gender_of(mother),
                },
                "children": [
                    make_node(by_id[c], relation_label="Child") for c in shared if c in by_id
                ],
            }
            if principal_id and (principal_id == a or principal_id == b):
                family_node["attributes"]["type"] = "Primary"
            families.append(family_node)
            used_as_parent.update([a, b])
            used_as_child.update(shared)

        # 2) Single-parent groups (parent with kids not yet shown)
        for pid, kids in children_of.items():
            if pid in used_as_parent:
                continue
            new_kids = [c for c in kids if c not in used_as_child]
            if not new_kids:
                continue
            parent = by_id.get(pid)
            if not parent:
                continue
            family_node = {
                "name": name_of(parent),
                "attributes": {
                    "id": f"family-{pid}",
                    "type": "Primary" if pid == principal_id else "Family",
                    "parents": [pid],
                },
                "children": [
                    make_node(by_id[c], relation_label="Child") for c in new_kids if c in by_id
                ],
            }
            families.append(family_node)
            used_as_parent.add(pid)
            used_as_child.update(new_kids)

        # 3) Orphans — persons that didn't appear as a parent or child anywhere
        orphans = [
            p for p in persons
            if p.get("id") not in used_as_parent and p.get("id") not in used_as_child
        ]

        # Single-family case: don't wrap in a synthetic root.
        if len(families) == 1 and not orphans:
            return families[0]
        if not families:
            # No relationships at all — just show every person as a flat list.
            return {
                "name": "Persons",
                "attributes": {"id": "root", "type": "Root"},
                "children": [make_node(p, relation_label="Person") for p in persons],
            }

        family_word = "Family" if len(families) == 1 else "Families"
        root = {
            "name": f"{len(families)} {family_word} on this page",
            "attributes": {"id": "root", "type": "Root"},
            "children": list(families),
        }
        if orphans:
            root["children"].append({
                "name": "Unrelated individuals",
                "attributes": {"id": "orphans", "type": "Other"},
                "children": [make_node(p, relation_label="Person") for p in orphans],
            })
        return root
