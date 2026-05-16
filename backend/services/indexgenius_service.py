"""Structured extraction — delegates to ai_service (OpenAI SDK, env-driven)."""
import logging

from backend.schemas.record import RecordExtraction, FamilyMember, Person, Relation, MetadataField
from backend.services.ai_service import ai_service

log = logging.getLogger(__name__)


def _clamp01(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f < 0:
        return 0.0
    if f > 1:
        return min(1.0, f / 100.0) if f <= 100 else 1.0
    return round(f, 3)


def _norm_gender(v):
    if not v:
        return None
    s = str(v).strip().lower()
    if s in ("m", "male", "man", "homme", "masculino"):
        return "M"
    if s in ("f", "female", "woman", "femme", "femenino"):
        return "F"
    return "U"


class IndexGeniusService:
    def __init__(self):
        self.ai = ai_service

    async def extract_record(self, text: str, image_path: str | None = None) -> RecordExtraction:
        # Pass the original document image alongside the OCR so Gemini sees
        # the form's visual layout (column headers, row alignment) — crucial
        # for correctly identifying father/mother/spouse columns on certs.
        raw = await self.ai.extract_record(text, image_path=image_path)
        # Defensive: ai layer should always return a dict but a misbehaving
        # model could still return a list — coerce so .get() is safe.
        if not isinstance(raw, dict):
            log.warning("extract_record received non-dict from ai_service: %s", type(raw).__name__)
            raw = {}

        fm_list = []
        for fm in raw.get("family_members") or []:
            if isinstance(fm, dict):
                name = (fm.get("name") or "").strip()
                relation = (fm.get("relation") or "").strip()
                if name:
                    fm_list.append(FamilyMember(name=name, relation=relation))

        persons = []
        for p in raw.get("persons") or []:
            if not isinstance(p, dict):
                continue
            name = (p.get("name") or "").strip()
            if not name:
                continue
            persons.append(Person(
                name=name,
                gender=_norm_gender(p.get("gender")),
                role=(p.get("role") or "").strip().lower() or None,
                age=p.get("age"),
                date_of_birth=p.get("date_of_birth"),
                date_of_death=p.get("date_of_death"),
                occupation=p.get("occupation"),
                place=p.get("place"),
                confidence=_clamp01(p.get("confidence")),
            ))

        valid_names = {p.name for p in persons}
        relations = []
        seen = set()
        for r in raw.get("relations") or []:
            if not isinstance(r, dict):
                continue
            a = (r.get("person_a") or "").strip()
            b = (r.get("person_b") or "").strip()
            t = (r.get("type") or "").strip().lower()
            if not a or not b or a == b or not t:
                continue
            if a not in valid_names and b not in valid_names:
                continue
            key = (a, b, t)
            rev = (b, a, t) if t in {"spouse_of", "sibling_of"} else None
            if key in seen or (rev and rev in seen):
                continue
            seen.add(key)
            relations.append(Relation(
                person_a=a, person_b=b, type=t,
                confidence=_clamp01(r.get("confidence")),
            ))

        metadata = []
        seen_m = set()
        for m in raw.get("metadata") or []:
            if not isinstance(m, dict):
                continue
            label = (m.get("label") or "").strip()
            value = (m.get("value") or "").strip()
            if not label or not value:
                continue
            k = (label.lower(), value.lower())
            if k in seen_m:
                continue
            seen_m.add(k)
            metadata.append(MetadataField(
                label=label, value=value,
                category=(m.get("category") or "").strip().lower() or None,
                confidence=_clamp01(m.get("confidence")),
                notes=(m.get("notes") or None),
            ))

        field_confidences = {}
        for k, v in (raw.get("field_confidences") or {}).items():
            c = _clamp01(v)
            if c is not None:
                field_confidences[str(k)] = c

        return RecordExtraction(
            record_number=raw.get("record_number"),
            event_type=raw.get("event_type"),
            given_name=raw.get("given_name"),
            surname=raw.get("surname"),
            date_of_birth=raw.get("date_of_birth"),
            date_of_death=raw.get("date_of_death"),
            date_of_event=raw.get("date_of_event"),
            place_of_event=raw.get("place_of_event"),
            father_name=raw.get("father_name"),
            mother_name=raw.get("mother_name"),
            family_members=fm_list,
            persons=persons,
            relations=relations,
            metadata=metadata,
            field_confidences=field_confidences,
            additional_info=raw.get("additional_info") or {},
        )
