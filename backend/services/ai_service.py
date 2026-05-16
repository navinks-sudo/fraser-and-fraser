"""Single AI client used by every stage of the pipeline.

Uses the OpenAI Python SDK against whatever OPENAI_BASE_URL points at — real
OpenAI, Gemini's openai-compatible shim, Ollama, vLLM, etc. Every knob (key,
URL, model per stage, temperature, timeout, retries) lives in .env.
"""
import asyncio
import base64
import io
import json
import logging
import re
from pathlib import Path
from typing import Optional

from PIL import Image as PILImage, ImageFile
from openai import AsyncOpenAI

from backend.config import settings

ImageFile.LOAD_TRUNCATED_IMAGES = True
log = logging.getLogger(__name__)

_MAX_DIMENSION = 2048


# ─── Image preparation ────────────────────────────────────────────────────
def _open_rgb(image_path: str) -> PILImage.Image:
    if not image_path or not Path(image_path).is_file():
        raise FileNotFoundError(f"Image not found on disk: {image_path}")
    img = PILImage.open(image_path)
    img.load()
    if img.mode != "RGB":
        if img.mode in ("RGBA", "LA"):
            bg = PILImage.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            img = bg
        elif img.mode == "P":
            img = img.convert("RGBA")
            bg = PILImage.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            img = bg
        else:
            img = img.convert("RGB")
    return img


def _to_data_url(img: PILImage.Image, max_dim: int = _MAX_DIMENSION) -> str:
    work = img.copy()
    if max(work.size) > max_dim:
        work.thumbnail((max_dim, max_dim), PILImage.LANCZOS)
    buf = io.BytesIO()
    work.save(buf, format="JPEG", quality=88, optimize=True)
    return f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode()}"


def _extract_json(raw: str):
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    m = re.search(r"\{.*\}", text, re.DOTALL) or re.search(r"\[.*\]", text, re.DOTALL)
    if m:
        text = m.group(0)
    return json.loads(text)


def _coerce_extraction_dict(parsed):
    """Some models wrap their response in an array (`[{...}]`) or return a
    bare list of persons. Normalise everything to a dict so downstream code
    can rely on `.get()` semantics.

    Returns a fresh dict matching the extract_record output shape.
    """
    empty = {
        "record_number": None, "event_type": None,
        "given_name": None, "surname": None,
        "date_of_birth": None, "date_of_death": None, "date_of_event": None,
        "place_of_event": None, "father_name": None, "mother_name": None,
        "family_members": [], "persons": [], "relations": [],
        "metadata": [], "field_confidences": {}, "additional_info": {},
    }
    if isinstance(parsed, dict):
        # Already a dict — leave alone but make sure list-typed keys are lists.
        for k in ("family_members", "persons", "relations", "metadata"):
            v = parsed.get(k)
            if not isinstance(v, list):
                parsed[k] = []
        if not isinstance(parsed.get("field_confidences"), dict):
            parsed["field_confidences"] = {}
        if not isinstance(parsed.get("additional_info"), dict):
            parsed["additional_info"] = {}
        return parsed
    if isinstance(parsed, list):
        # AI wrapped the response in an array
        if not parsed:
            return empty
        first = parsed[0]
        if isinstance(first, dict) and any(
            k in first for k in ("persons", "relations", "metadata", "given_name")
        ):
            # Top-level is a list whose first element is the actual extraction
            return _coerce_extraction_dict(first)
        # Otherwise treat the array as a bare persons[] list
        empty["persons"] = [p for p in parsed if isinstance(p, dict)]
        return empty
    return empty


# Patterns that match the legal-warning boilerplate stamped on UK/EU certificates.
# Stripping these BEFORE sending to the LLM keeps the safety filter quiet and
# focuses the model on the actual record content.
_BOILERPLATE_PATTERNS = [
    r"CAUTION[:\s]+THERE ARE OFFENCES RELATING TO FALSIFYING.*?CERTIFICATE\.?",
    r"AND USING OR POSSESSING A FALSE CERTIFICATE\.?",
    r"©\s*CROWN COPYRIGHT",
    r"WARNING[:\s]+A CERTIFICATE IS NOT EVIDENCE OF IDENTITY\.?",
    r"CERTIFIED to be a true copy of an entry in the certified copy of\*?\s*"
    r"a register of Births,?\s*Still-births\s*or Deaths in the District above mentioned\.?",
    r"Given at the GENERAL REGISTER OFFICE.*?the Seal of the said Office.*?\d{4}\.?",
    r"\*If the Certificate is given from the original Register,?\s*the words.*?are struck out\.?",
    r"GENERAL\s+REGISTER\s+OFFICE.*?ENGLAND\s+AND\s+WALES",
]
_BOILERPLATE_RE = re.compile(
    "|".join(_BOILERPLATE_PATTERNS),
    re.IGNORECASE | re.DOTALL,
)


def _strip_certificate_boilerplate(text: str) -> str:
    """Remove legal-warning boilerplate so the AI's safety filter doesn't
    mistake the certificate noise for a privacy-sensitive request."""
    if not text:
        return ""
    cleaned = _BOILERPLATE_RE.sub(" ", text)
    # Collapse the whitespace left behind by deletions
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _backfill_scalar_relations(extraction) -> dict:
    """Make sure obvious parent/spouse links from scalar fields end up in
    relations[]. The AI populates father_name, mother_name, given_name,
    surname — those are AI decisions just stored in different keys. If the
    matching parent_of / spouse_of relation is missing from relations[],
    synthesise it here so the tree builder has a complete picture.

    Doesn't add anything the AI didn't already commit to; this is a normalisation
    step, not a guess.
    """
    # Defensive: callers across the codebase pass in arbitrary JSON. Coerce
    # to a well-shaped dict so .get() / list iteration is always safe.
    if not isinstance(extraction, dict):
        extraction = _coerce_extraction_dict(extraction)
    persons = extraction.get("persons")
    relations = extraction.get("relations")
    if not isinstance(persons, list):
        persons = []
    if not isinstance(relations, list):
        relations = []
    # Strip any non-dict entries that slipped in (e.g. AI returning bare strings)
    persons = [p for p in persons if isinstance(p, dict)]
    relations = [r for r in relations if isinstance(r, dict)]

    # Build name lookup: lowercase → canonical full name from persons[]
    name_set = {(p.get("name") or "").strip() for p in persons if isinstance(p, dict) and p.get("name")}
    name_set = {n for n in name_set if n}
    name_lookup = {n.lower(): n for n in name_set}

    def find_in_persons(query: str) -> str | None:
        """Locate a person in persons[] by exact/substring/token-subset match."""
        q = (query or "").strip()
        if not q:
            return None
        qlow = q.lower()
        if qlow in name_lookup:
            return name_lookup[qlow]
        # Substring match either way
        for canon_low, canon in name_lookup.items():
            if qlow in canon_low or canon_low in qlow:
                return canon
        # Token-subset: every token of q present in some person's name
        q_tokens = {t for t in re.split(r"\s+", qlow) if t}
        for canon_low, canon in name_lookup.items():
            p_tokens = set(re.split(r"\s+", canon_low))
            if q_tokens and q_tokens.issubset(p_tokens):
                return canon
        return None

    def ensure_person(name: str, gender: str | None, role: str | None) -> str | None:
        nonlocal persons
        clean = (name or "").strip()
        if not clean:
            return None
        existing = find_in_persons(clean)
        if existing:
            return existing
        new = {"name": clean, "confidence": 0.6}
        if gender in {"M", "F"}:
            new["gender"] = gender
        if role:
            new["role"] = role
        persons.append(new)
        name_set.add(clean)
        name_lookup[clean.lower()] = clean
        return clean

    def has_rel(a: str, b: str, t: str) -> bool:
        a_low = a.lower()
        b_low = b.lower()
        for r in relations:
            if not isinstance(r, dict):
                continue
            rt = (r.get("type") or "").lower()
            if rt != t.lower():
                continue
            ra = (r.get("person_a") or "").lower()
            rb = (r.get("person_b") or "").lower()
            if (ra == a_low and rb == b_low):
                return True
            # Couple is symmetric
            if t == "spouse_of" and (ra == b_low and rb == a_low):
                return True
        return False

    def add_rel(a: str, b: str, t: str, why: str):
        if not a or not b or a == b:
            return
        if has_rel(a, b, t):
            return
        relations.append({
            "person_a": a, "person_b": b, "type": t,
            "confidence": 0.85, "source": why,
        })

    # Derive subject from given_name + surname or fall back to a person with role=subject
    subject_name = " ".join(
        filter(None, [
            (extraction.get("given_name") or "").strip(),
            (extraction.get("surname") or "").strip(),
        ])
    ).strip()
    if subject_name:
        canon = find_in_persons(subject_name) or ensure_person(subject_name, None, "subject")
        subject_name = canon
    else:
        # Search persons[] for a role=subject
        for p in persons:
            if isinstance(p, dict) and (p.get("role") or "").strip().lower() == "subject":
                subject_name = (p.get("name") or "").strip()
                break

    # Strip "(formerly Allsop)" / "née X" type suffixes from father/mother strings
    def _clean_parent_name(raw: str) -> str:
        if not raw:
            return ""
        # Remove parenthetical suffixes
        cleaned = re.sub(r"\s*\([^)]*\)\s*", " ", raw)
        # Remove "formerly ..." / "née ..." / "nee ..." suffixes
        cleaned = re.sub(r"\s+(?:formerly|née|nee|maiden)\s+\S+.*$", "", cleaned, flags=re.IGNORECASE)
        return cleaned.strip()

    father_raw = extraction.get("father_name") or ""
    mother_raw = extraction.get("mother_name") or ""
    father_name = _clean_parent_name(father_raw)
    mother_name = _clean_parent_name(mother_raw)

    derived: list[str] = []
    if subject_name:
        if father_name:
            fname = find_in_persons(father_name) or ensure_person(father_name, "M", "father")
            if fname and fname != subject_name and not has_rel(fname, subject_name, "parent_of"):
                add_rel(fname, subject_name, "parent_of", "father_name scalar")
                derived.append(f"parent_of({fname}→{subject_name})")
        if mother_name:
            mname = find_in_persons(mother_name) or ensure_person(mother_name, "F", "mother")
            if mname and mname != subject_name and not has_rel(mname, subject_name, "parent_of"):
                add_rel(mname, subject_name, "parent_of", "mother_name scalar")
                derived.append(f"parent_of({mname}→{subject_name})")
        if father_name and mother_name:
            fname = find_in_persons(father_name)
            mname = find_in_persons(mother_name)
            if fname and mname and not has_rel(fname, mname, "spouse_of"):
                add_rel(fname, mname, "spouse_of", "father+mother scalars imply marriage")
                derived.append(f"spouse_of({fname}↔{mname})")

    # Also pull from family_members[] when role names imply parent/child/spouse
    fm_list = extraction.get("family_members") or []
    role_to_parent = {"father", "mother", "parent", "stepfather", "stepmother"}
    role_to_child = {"son", "daughter", "child", "stepson", "stepdaughter"}
    role_to_spouse = {"spouse", "husband", "wife"}
    role_to_gender = {
        "father": "M", "son": "M", "brother": "M", "husband": "M", "uncle": "M", "grandfather": "M",
        "mother": "F", "daughter": "F", "sister": "F", "wife": "F", "aunt": "F", "grandmother": "F",
    }
    if isinstance(fm_list, list) and subject_name:
        for fm in fm_list:
            if not isinstance(fm, dict):
                continue
            nm = (fm.get("name") or "").strip()
            rel = (fm.get("relation") or "").strip().lower()
            if not nm or not rel:
                continue
            other = find_in_persons(nm) or ensure_person(nm, role_to_gender.get(rel), rel)
            if not other or other == subject_name:
                continue
            if rel in role_to_parent and not has_rel(other, subject_name, "parent_of"):
                add_rel(other, subject_name, "parent_of", f"family_members: {rel}")
                derived.append(f"parent_of({other}→{subject_name})")
            elif rel in role_to_child and not has_rel(subject_name, other, "parent_of"):
                add_rel(subject_name, other, "parent_of", f"family_members: {rel}")
                derived.append(f"parent_of({subject_name}→{other})")
            elif rel in role_to_spouse and not has_rel(subject_name, other, "spouse_of"):
                add_rel(subject_name, other, "spouse_of", f"family_members: {rel}")
                derived.append(f"spouse_of({subject_name}↔{other})")

    if derived:
        log.info("[extract_record] backfilled %d relations from scalars: %s", len(derived), ", ".join(derived))
        extraction.setdefault("additional_info", {})["_relations_backfilled"] = derived

    extraction["persons"] = persons
    extraction["relations"] = relations
    return extraction


# ─── Client ───────────────────────────────────────────────────────────────
class AIService:
    """Wraps the AsyncOpenAI client and exposes pipeline-specific methods.

    Every call respects settings.* — keys, base URL, timeout, retries, model
    per stage. No hardcoded values.
    """

    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=settings.openai_api_key or "none",
            base_url=settings.openai_base_url,
            timeout=settings.openai_timeout,
            max_retries=settings.openai_max_retries,
        )

    @property
    def is_configured(self) -> bool:
        return bool(settings.openai_api_key and settings.openai_base_url)

    async def _chat(self, *, model: str, messages: list, json_mode: bool = False, max_tokens: Optional[int] = None) -> str:
        kwargs = {
            "model": model,
            "messages": messages,
            "temperature": settings.openai_temperature,
            "max_tokens": max_tokens or settings.openai_max_tokens,
        }
        if json_mode:
            # OpenAI + Gemini's compat shim both accept this
            try:
                kwargs["response_format"] = {"type": "json_object"}
            except Exception:
                pass
        resp = await self.client.chat.completions.create(**kwargs)
        return (resp.choices[0].message.content or "").strip()

    # ── Vision OCR ──
    async def ocr_image(self, image_path: str, bbox: Optional[list] = None, prompt: Optional[str] = None) -> str:
        img = _open_rgb(image_path)
        if bbox and len(bbox) == 4:
            x1, y1, x2, y2 = [int(v) for v in bbox]
            x1 = max(0, min(x1, img.width))
            x2 = max(0, min(x2, img.width))
            y1 = max(0, min(y1, img.height))
            y2 = max(0, min(y2, img.height))
            if x2 > x1 and y2 > y1:
                img = img.crop((x1, y1, x2, y2))

        data_url = _to_data_url(img)
        text_prompt = prompt or (
            "Perform OCR on this historical document. Transcribe every line exactly "
            "as it appears, preserving line breaks. Return ONLY the transcribed text "
            "— no commentary, no markdown."
        )
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": text_prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }]
        return await self._chat(model=settings.model_for_vision, messages=messages)

    # ── Region segmentation ──
    async def detect_regions(self, image_path: str) -> dict:
        img = _open_rgb(image_path)
        orig_size = img.size
        work = img.copy()
        if max(work.size) > _MAX_DIMENSION:
            work.thumbnail((_MAX_DIMENSION, _MAX_DIMENSION), PILImage.LANCZOS)
        sent_size = work.size
        data_url = _to_data_url(work, max_dim=_MAX_DIMENSION)

        prompt = (
            "Identify each separate genealogical record entry on this page (births, "
            "marriages, deaths, baptisms, burials). "
            f"The image you are seeing is {sent_size[0]} x {sent_size[1]} px. "
            "Return ONLY JSON: "
            '{"regions": [{"index": 1, "bbox": [x1,y1,x2,y2], "summary": "Birth of …", "language": "fr"}]}'
        )
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }]
        raw = await self._chat(model=settings.model_for_vision, messages=messages, json_mode=True)
        try:
            data = _extract_json(raw)
        except json.JSONDecodeError:
            return {"regions": [], "image_width": orig_size[0], "image_height": orig_size[1]}

        sx = orig_size[0] / sent_size[0] if sent_size[0] else 1
        sy = orig_size[1] / sent_size[1] if sent_size[1] else 1
        cleaned = []
        for idx, r in enumerate(data.get("regions") or [], start=1):
            bb = r.get("bbox") or []
            if len(bb) != 4:
                continue
            x1, y1, x2, y2 = bb
            x1, x2 = sorted([max(0, x1), min(sent_size[0], x2)])
            y1, y2 = sorted([max(0, y1), min(sent_size[1], y2)])
            cleaned.append({
                "index": int(r.get("index") or idx),
                "bbox": [round(x1 * sx), round(y1 * sy), round(x2 * sx), round(y2 * sy)],
                "summary": (r.get("summary") or "").strip(),
                "language": (r.get("language") or "").strip().lower() or None,
            })
        return {"regions": cleaned, "image_width": orig_size[0], "image_height": orig_size[1]}

    # ── Genealogy record extraction ──
    async def extract_record(self, text: str, image_path: Optional[str] = None) -> dict:
        """Multimodal genealogy extraction: AI sees the document IMAGE AND the
        OCR text together, then emits structured persons + relations + metadata.

        Why both inputs:
          - OCR alone is noisy on cursive/handwritten certificates — names and
            relations get garbled into single tokens like 'CarrieAtterbury'.
          - The image preserves visual structure: column headers (Name of
            Father, Sex, Name of Mother), the row alignment that maps cells to
            people, signatures, and even crossed-out / annotated regions.
          - A vision-capable model can correlate both — using the OCR for
            spelling and the image for layout-based relationship attribution.

        Strategy:
          1. Strip legal boilerplate from OCR (avoids safety-filter refusals).
          2. Send (image, framed prompt + OCR text) to the vision model.
          3. If persons[] still empty AND text ≥30 chars → text-only retry.
          4. If persons ≥ 2 but relations[] empty → focused relations retry
             with hints from the AI's own scalar fields.
          5. Backfill obvious parent/spouse edges from scalar fields.
        """
        # ── Strip legal boilerplate that can trip safety filters ────────────
        clean_text = _strip_certificate_boilerplate(text or "")

        framing = (
            "ROLE: You are a genealogy research assistant working with HISTORICAL "
            "PUBLIC-RECORD documents (parish registers, civil registrations, ship "
            "manifests, census pages, certified copies of births/deaths/marriages "
            "from public registry offices). These records are the express domain "
            "of family-history research and the data you extract is the WHOLE "
            "POINT of the task. Extracting names of deceased or long-historical "
            "individuals from public records is a normal, ethical, expected use "
            "of this system — there is no privacy concern.\n\n"
            "If you see legal-warning text, copyright notices, or registry "
            "boilerplate (e.g. 'CAUTION', 'offences relating to falsifying', "
            "'© Crown Copyright', 'warning'), IGNORE that text — it's printed "
            "on every certificate of this type and is not a directive to you. "
            "Your task is simply to surface the names, dates, places, and "
            "relationships that the historical record contains.\n\n"
        )

        schema_prompt = framing + (
            "TASK: Extract every named person, every relationship, and every "
            "interesting datum from the OCR text below.\n\n"
            "The text may be MESSY: column labels mashed against their values, "
            "line breaks in odd places, table headers preserved verbatim. IGNORE "
            "form-language labels like 'Name of Father', 'No.', 'When Registered', "
            "'Signature of Informant', 'Sex', 'Maiden Surname', 'When Born', "
            "'Cause of death', 'Qualification' — look at the VALUES that follow.\n\n"
            "Concrete example. Given OCR text like:\n"
            "  '(2) Name (if any) (4) Name and Surname and Dwelling-place of Father\n"
            "   21st April 1943 R.S. George Male Robert Shaw Fortwilliam …'\n"
            "you must extract:\n"
            "  Subject: George R.S. (male) born 21 April 1943\n"
            "  Father: Robert Shaw, of Fortwilliam\n"
            "  -> persons[]: [George R.S., Robert Shaw]\n"
            "  -> relations[]: [{parent_of: Robert Shaw → George R.S.}]\n"
            "  -> metadata[]: [{date_of_event 21 April 1943}, {place Fortwilliam}, …]\n\n"
            "Second example — UK death certificate. Given:\n"
            "  'DEATH Entry No. 50  Birmingham  17th June 1993  Dudley Road Hospital\n"
            "   Albert Wojciech Morkowski  Male  13th February 1922 Germany\n"
            "   Metal Works Inspector retired  9 Friary Road, Birmingham 20\n"
            "   Roger Albert Morkowski Son  Pulmonary Embolism  B. Dickinson M.B.\n"
            "   R. Makowski Signature of Informant  18 June 1993  M. Cooper Registrar'\n"
            "you must produce:\n"
            "  event_type: death\n"
            "  given_name: 'Albert Wojciech', surname: 'Morkowski'\n"
            "  date_of_death: '17 June 1993', date_of_birth: '13 February 1922'\n"
            "  place_of_event: 'Dudley Road Hospital, Birmingham'\n"
            "  persons[]: [\n"
            "    {Albert Wojciech Morkowski, M, subject, occupation: Metal Works Inspector (retired)},\n"
            "    {Roger Albert Morkowski, M, son},\n"
            "    {B. Dickinson, U, doctor},\n"
            "    {M. Cooper, U, registrar}\n"
            "  ]\n"
            "  relations[]: [\n"
            "    {person_a: 'Albert Wojciech Morkowski', person_b: 'Roger Albert Morkowski', type: parent_of}\n"
            "  ]\n"
            "  metadata[]: date_of_death · place_of_birth · occupation · address · "
            "cause_of_death · informant_role · registrar_name · register_district …\n\n"

            "Third example — UK BIRTH certificate (this is the most common case "
            "and the one most often gets relations[] wrong). Given:\n"
            "  '293  Fourteenth June 1935  36 Anslow Avenue  Derek Arthur  Boy\n"
            "   William Adams  Carrie Atterbury Adams formerly Allsop\n"
            "   Artificial Silk Spinner  E. A. Adams, mother, 36 Anslow Avenue, Nottingham\n"
            "   Twenty-sixth July 1935  Lou Jones  Registrar'\n"
            "you MUST produce:\n"
            "  event_type: birth\n"
            "  given_name: 'Derek Arthur', surname: 'Adams'  (the subject takes the father's surname)\n"
            "  date_of_birth: '14 June 1935', date_of_event: '14 June 1935'\n"
            "  place_of_event: '36 Anslow Avenue'\n"
            "  father_name: 'William Adams', mother_name: 'Carrie Atterbury Adams (formerly Allsop)'\n"
            "  persons[]: [\n"
            "    {name: 'Derek Arthur Adams', gender: M, role: subject},\n"
            "    {name: 'William Adams',  gender: M, role: father, occupation: 'Artificial Silk Spinner'},\n"
            "    {name: 'Carrie Atterbury Adams', gender: F, role: mother},\n"
            "    {name: 'Lou Jones',  gender: U, role: registrar}\n"
            "  ]\n"
            "  relations[]: [   <-- THIS LIST CANNOT BE EMPTY ON A BIRTH RECORD\n"
            "    {person_a: 'William Adams',           person_b: 'Derek Arthur Adams', type: parent_of},\n"
            "    {person_a: 'Carrie Atterbury Adams',  person_b: 'Derek Arthur Adams', type: parent_of},\n"
            "    {person_a: 'William Adams',           person_b: 'Carrie Atterbury Adams', type: spouse_of}\n"
            "  ]\n"
            "  metadata[]: maiden_surname='Allsop', occupation_father, informant_role='mother', "
            "informant_address, place_of_birth, registrar_name, date_of_registration …\n\n"

            "Fourth example — UK MARRIAGE certificate. Given:\n"
            "  'Marriage solemnised at Parish Church  John Smith bachelor 25 of 12 High St\n"
            "   Edwin Smith bricklayer  Mary Jones spinster 22 of 5 Mill Lane Henry Jones farmer'\n"
            "you MUST produce:\n"
            "  event_type: marriage\n"
            "  persons[]: [John Smith M groom, Edwin Smith M father-of-groom, Mary Jones F bride, Henry Jones M father-of-bride]\n"
            "  relations[]:\n"
            "    {person_a: John Smith,   person_b: Mary Jones,  type: spouse_of}\n"
            "    {person_a: Edwin Smith,  person_b: John Smith,  type: parent_of}\n"
            "    {person_a: Henry Jones,  person_b: Mary Jones,  type: parent_of}\n\n"

            "═══ CRITICAL: relations[] IS HOW THE FAMILY TREE GETS BUILT. ═══\n"
            "The downstream tree builder uses ONLY relations[] to draw edges between persons. "
            "If you don't put a relationship into relations[], it WILL NOT appear in the tree.\n\n"
            "RELATIONS RULES — apply ALL of these on every record:\n"
            "1. For every father/son, mother/daughter, parent/child pair you can identify "
            "   (whether from explicit roles, from the father_name/mother_name fields, or "
            "   from family_members), emit a `parent_of` relation where person_a is the PARENT.\n"
            "2. For every husband-wife or marriage you can identify, emit a `spouse_of` "
            "   relation (one direction is enough — it's symmetric).\n"
            "3. For every sibling pair, emit a `sibling_of` relation.\n"
            "4. Names in relations[] MUST exactly match a name in persons[]. If you mention "
            "   'Robert Shaw' as person_a, then 'Robert Shaw' must also appear in persons[].\n"
            "5. Doctors, registrars, informants, witnesses are people — include them in "
            "   persons[] — but DO NOT emit family relations for them unless the text says "
            "   they're also a relative (e.g. 'informant: son'). If the informant IS a son, "
            "   you DO emit parent_of (subject→informant).\n"
            "6. From scalar fields father_name='Robert Shaw' and the subject being George Shaw, "
            "   you MUST add 'Robert Shaw' to persons[] AND emit parent_of(Robert Shaw, George Shaw) "
            "   in relations[]. Same for mother_name. The downstream tree DOES NOT auto-link "
            "   from scalar fields — only relations[] is used.\n"
            "7. If a marriage record names a husband and wife, emit spouse_of and add BOTH to "
            "   persons[]. If parents-of-bride/groom are named, emit parent_of links for each.\n\n"

            "BE AGGRESSIVE. Even when the source is a column-labelled form, mine for "
            "every name, every date, every place, every occupation, every role. "
            "Returning persons:[] is almost always WRONG when the text is longer "
            "than ~30 chars — there will be at least one named individual. Returning "
            "relations:[] is almost always WRONG too — if there are 2+ named persons "
            "there is almost certainly a family link between at least some of them.\n\n"
            "Return ONLY this JSON, no markdown, no commentary:\n"
            "{\n"
            '  "record_number": "string or null",\n'
            '  "event_type": "birth | death | marriage | baptism | burial | other | null",\n'
            '  "given_name": "string or null",\n'
            '  "surname": "string or null",\n'
            '  "date_of_birth": "string or null",\n'
            '  "date_of_death": "string or null",\n'
            '  "date_of_event": "string or null",\n'
            '  "place_of_event": "string or null",\n'
            '  "father_name": "string or null",\n'
            '  "mother_name": "string or null",\n'
            '  "family_members": [{"name": "string", "relation": "string"}],\n'
            '  "persons": [\n'
            '    {"name":"FULL NAME","gender":"M|F|U","role":"subject|father|mother|spouse|child|witness|godfather|godmother|priest|informant|registrar|doctor|other",\n'
            '     "age":"string|null","date_of_birth":"string|null","date_of_death":"string|null",\n'
            '     "occupation":"string|null","place":"string|null","confidence":0.0-1.0}\n'
            '  ],\n'
            '  "relations": [\n'
            '    {"person_a":"name","person_b":"name","type":"parent_of|child_of|spouse_of|sibling_of|godparent_of|witness_of|other","confidence":0.0-1.0}\n'
            '  ],\n'
            '  "metadata": [\n'
            '    {"label":"...","value":"...","category":"date|place|name|occupation|age|civil_status|religious|event|identifier|language|military|medical|other","confidence":0.0-1.0,"notes":null}\n'
            '  ],\n'
            '  "field_confidences": {"given_name":0.0-1.0, "surname":0.0-1.0, "father_name":0.0-1.0, "mother_name":0.0-1.0, "date_of_event":0.0-1.0, "place_of_event":0.0-1.0, "event_type":0.0-1.0},\n'
            '  "additional_info": {}\n'
            "}\n"
            "RULES:\n"
            "- persons[] must include EVERY human mentioned. Infer gender from name/context.\n"
            "- Compose full names: 'Calineau Jacques' → 'Jacques Calineau' as ONE person.\n"
            "- relations[]: parent_of has person_a = parent, person_b = child.\n"
            "- metadata[] is OPEN-ENDED — every interesting datum gets a row.\n"
            "- Confidence: 1.0 plainly written, 0.7 minor doubt, 0.4 inferred, 0.2 guess.\n"
            "- If unsure of a name, include it with confidence 0.3 rather than skipping.\n"
        )

        # ── Prepare the image (if any) as a base64 data URL for multimodal calls.
        # Vision-capable Gemini/OpenAI accept image_url content parts via the
        # OpenAI Chat Completions API; we pass the cert image inline so the
        # model can correlate the form's column layout with the OCR tokens.
        image_data_url: Optional[str] = None
        if image_path:
            try:
                img = _open_rgb(image_path)
                image_data_url = _to_data_url(img)
            except FileNotFoundError:
                log.warning("[extract_record] image path missing: %s", image_path)
            except Exception as e:
                log.warning("[extract_record] image prep failed: %s", e)

        async def _run_pass(prompt: str, tag: str, *, use_image: bool = True) -> dict:
            if use_image and image_data_url:
                content = [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ]
                messages = [{"role": "user", "content": content}]
                model_name = settings.model_for_vision  # use vision-capable model
            else:
                messages = [{"role": "user", "content": prompt}]
                model_name = settings.model_for_extraction
            raw = await self._chat(
                model=model_name,
                messages=messages,
                json_mode=True,
            )
            log.info(
                "[extract_record %s] model=%s image=%s raw_len=%d head=%r",
                tag, model_name, bool(use_image and image_data_url),
                len(raw or ""), (raw or "")[:200],
            )
            try:
                raw_parsed = _extract_json(raw)
                parsed = _coerce_extraction_dict(raw_parsed)
                if not isinstance(raw_parsed, dict):
                    log.warning(
                        "[extract_record %s] AI returned %s at top level — coerced to dict",
                        tag, type(raw_parsed).__name__,
                    )
                log.info(
                    "[extract_record %s] parsed: persons=%d relations=%d metadata=%d",
                    tag,
                    len(parsed.get("persons") or []),
                    len(parsed.get("relations") or []),
                    len(parsed.get("metadata") or []),
                )
                return parsed
            except json.JSONDecodeError as e:
                log.warning("[extract_record %s] JSON parse failed: %s", tag, e)
                empty = _coerce_extraction_dict(None)
                empty["additional_info"] = {"_raw": (raw or "")[:500]}
                return empty

        log.info(
            "[extract_record] input: orig_len=%d, cleaned_len=%d, image=%s, head=%r",
            len(text or ""), len(clean_text), bool(image_data_url), clean_text[:200],
        )
        # Pass 1 — multimodal: image + OCR text together
        multimodal_pretext = (
            "You have BOTH a scan of the original document (image attached) AND "
            "an OCR transcription (below). Use the IMAGE to understand the form's "
            "column/row layout — which cell is the father's name column, which is "
            "the mother's, which is the informant's. Use the OCR text for accurate "
            "spelling. Cross-reference the two: where OCR is garbled, fall back on "
            "the image; where the image is unclear, fall back on OCR.\n\n"
        ) if image_data_url else ""
        first = await _run_pass(
            f"{schema_prompt}\n{multimodal_pretext}--- HISTORICAL RECORD OCR TEXT ---\n{clean_text}",
            "pass1",
        )

        # If the first pass came back empty but the OCR text is substantial,
        # retry with an aggressive name-finder prompt and merge the results.
        if len(first.get("persons", []) or []) == 0 and len(clean_text) >= 30:
            log.info("[extract_record] first pass empty, attempting aggressive retry")
            retry_prompt = (
                framing
                + "URGENT: The previous extraction returned ZERO persons from this "
                "historical public record. That is almost certainly wrong — the text "
                "below contains identifiable names of long-deceased individuals (this "
                "is public-record genealogy data, NOT private information).\n\n"
                "Scan again, character by character. List EVERY capitalised proper noun "
                "that could plausibly be a person's name. Be liberal: 'Robert Shaw', "
                "'Mary Murphy', 'Fr. Calineau', 'R. Makowski', 'M. Cooper', "
                "'B. Dickinson' — all are people. Include initialised names ('R.S.'), "
                "surname-first orderings ('Morkowski Albert'), and names mashed against "
                "role labels.\n\n"
                "Pull every date, place, age, occupation into metadata[].\n\n"
                "DO NOT return persons:[] again. If you genuinely see no names, you "
                "are misreading the text — try harder.\n\n"
                + schema_prompt
                + "\n--- HISTORICAL RECORD TEXT ---\n"
                + clean_text
            )
            second = await _run_pass(retry_prompt, "pass2-retry")
            if len(second.get("persons", []) or []) > 0:
                first["persons"] = second.get("persons") or []
                first["relations"] = second.get("relations") or first.get("relations") or []
                if not first.get("metadata"):
                    first["metadata"] = second.get("metadata") or []
                for k in (
                    "given_name", "surname", "father_name", "mother_name",
                    "date_of_event", "place_of_event", "event_type",
                    "date_of_birth", "date_of_death",
                ):
                    if not first.get(k) and second.get(k):
                        first[k] = second[k]
                first.setdefault("additional_info", {})["_recovered_on_retry"] = True

        # If we have ≥2 persons but ZERO relations, fire a focused relations-only
        # retry. The tree builder depends entirely on relations[], so this is the
        # difference between an isolated cluster of names and an actual family.
        persons_now = first.get("persons") or []
        relations_now = first.get("relations") or []
        if len(persons_now) >= 2 and len(relations_now) == 0:
            log.info(
                "[extract_record] persons=%d but relations=0 — firing relations-focused retry",
                len(persons_now),
            )
            person_list_str = "\n".join(
                f"  - {p.get('name')} ({p.get('gender') or '?'}, role: {p.get('role') or '?'})"
                for p in persons_now if p.get('name')
            )
            father_hint = (first.get("father_name") or "").strip()
            mother_hint = (first.get("mother_name") or "").strip()
            subject_hint = " ".join(filter(None, [first.get("given_name"), first.get("surname")])).strip()

            rel_prompt = framing + (
                "TASK: Identify EVERY family relationship between the persons listed "
                "below, based on the OCR text. The downstream family-tree builder uses "
                "ONLY your relations[] output — if you omit a relationship here, it "
                "will not appear in the tree.\n\n"
                f"PERSONS already extracted from this record:\n{person_list_str}\n\n"
                + (f"Note: scalar field father_name='{father_hint}' implies a parent_of relation from this person to the subject.\n" if father_hint else "")
                + (f"Note: scalar field mother_name='{mother_hint}' implies a parent_of relation from this person to the subject.\n" if mother_hint else "")
                + (f"Note: scalar field subject is '{subject_hint}'.\n" if subject_hint else "")
                + "\n"
                "Rules (apply ALL):\n"
                "1. parent_of: person_a = parent, person_b = child. Father→son, Mother→daughter, etc.\n"
                "2. spouse_of: husband ↔ wife, bride ↔ groom.\n"
                "3. sibling_of: brothers, sisters.\n"
                "4. Names in relations[] MUST exactly match names in persons[].\n"
                "5. Doctors, registrars, witnesses are typically NOT family — skip those "
                "   unless the text explicitly says they're also a relative.\n"
                "6. ABSOLUTELY DO NOT return relations:[]. If you see 2+ named persons "
                "   on a record there is almost always at least one family link.\n\n"
                "Return ONLY the JSON schema below. The persons[] you return must match "
                "the persons[] already extracted (same names). The relations[] must list "
                "EVERY parent/spouse/sibling pair you can infer.\n\n"
                + schema_prompt
                + "\n--- HISTORICAL RECORD TEXT ---\n"
                + clean_text
            )
            third = await _run_pass(rel_prompt, "pass3-relations")
            if len(third.get("relations") or []) > 0:
                first["relations"] = third["relations"]
                first.setdefault("additional_info", {})["_relations_recovered_on_retry"] = True

        # ── Safety net: synthesise obvious relations from the AI's own scalar
        # fields if it forgot to put them in relations[]. The AI populated
        # father_name / mother_name / given_name / surname — those scalars
        # ARE AI output, just stored in different keys. If the matching
        # parent_of / spouse_of relation is missing, fill it in.
        first = _backfill_scalar_relations(first)

        return first

    # ── Spreadsheet extraction ──
    async def extract_from_spreadsheet(self, sheets: list, max_rows: int = 150) -> dict:
        if not sheets:
            return {"persons": [], "relations": [], "metadata": []}
        compact = []
        truncated = False
        total_rows = sum(len(s.get("rows") or []) for s in sheets)
        for s in sheets:
            rows = s.get("rows") or []
            if len(rows) > max_rows:
                truncated = True
            compact.append({
                "name": s.get("name"),
                "columns": s.get("columns") or [],
                "rows": rows[:max_rows],
            })

        prompt = (
            "You are extracting genealogy data from a spreadsheet. Identify every person, "
            "infer gender, identify every kinship link, and capture every interesting cell "
            "value as metadata.\n\n"
            "Return ONLY this JSON, no markdown:\n"
            "{\n"
            '  "persons": [{"name":"...","gender":"M|F|U","role":"...","age":null,"date_of_birth":null,'
            '"date_of_death":null,"occupation":null,"place":null,"confidence":0.0-1.0}],\n'
            '  "relations": [{"person_a":"...","person_b":"...","type":"parent_of|child_of|spouse_of|sibling_of|other","confidence":0.0-1.0}],\n'
            '  "metadata": [{"label":"...","value":"...","category":"date|place|name|occupation|other","confidence":0.0-1.0,"notes":null}]\n'
            "}\n"
            "Names must match exactly between persons[] and relations[].\n"
            f"\n--- SHEETS ---\n{json.dumps(compact, ensure_ascii=False, indent=2)}"
        )
        raw = await self._chat(
            model=settings.model_for_extraction,
            messages=[{"role": "user", "content": prompt}],
            json_mode=True,
        )
        try:
            data = _extract_json(raw)
        except json.JSONDecodeError:
            data = {"persons": [], "relations": [], "metadata": [], "additional_info": {"_raw": raw[:500]}}
        if truncated:
            info = data.get("additional_info") or {}
            info["truncated"] = True
            info["total_rows_in_file"] = total_rows
            info["rows_sent_to_ai"] = sum(min(len(s.get("rows") or []), max_rows) for s in sheets)
            data["additional_info"] = info
        return data

    # ── Cross-record family tree synthesis ──
    async def build_family_tree(self, records: list) -> dict:
        if not records:
            return {"persons": [], "relationships": []}

        trimmed = [{
            "record_index": i + 1,
            "image_id": r.get("image_id"),
            "given_name": r.get("given_name"),
            "surname": r.get("surname"),
            "event_type": r.get("event_type"),
            "date_of_birth": r.get("date_of_birth"),
            "date_of_death": r.get("date_of_death"),
            "date_of_event": r.get("date_of_event"),
            "father_name": r.get("father_name"),
            "mother_name": r.get("mother_name"),
            "family_members": r.get("family_members") or [],
        } for i, r in enumerate(records)]

        prompt = (
            "Analyse these extracted genealogy records. Identify every UNIQUE person "
            "across all records — merge same-name spellings into ONE node. Identify all "
            "ParentChild and Couple relationships. Mark gender from names + roles.\n\n"
            "Return ONLY this GedcomX JSON, no markdown:\n"
            "{\n"
            '  "persons": [{"id":"p1","names":[{"nameForms":[{"fullText":"..."}]}],'
            '"gender":{"type":"http://gedcomx.org/Male"},"principal":false,'
            '"facts":[{"type":"http://gedcomx.org/Birth","date":{"original":"..."},"place":{"original":"..."}}]}],\n'
            '  "relationships": [\n'
            '    {"type":"http://gedcomx.org/ParentChild","person1":{"resource":"#p2"},"person2":{"resource":"#p1"}},\n'
            '    {"type":"http://gedcomx.org/Couple","person1":{"resource":"#p2"},"person2":{"resource":"#p3"}}\n'
            '  ]\n'
            "}\n"
            "RULES: person1 is parent in ParentChild. Resource IDs start with #. Gender URLs: "
            "Male/Female. Compose full names — never split surname & given name into two people.\n\n"
            f"RECORDS:\n{json.dumps(trimmed, ensure_ascii=False, indent=2)}"
        )
        raw = await self._chat(
            model=settings.model_for_tree,
            messages=[{"role": "user", "content": prompt}],
            json_mode=True,
        )
        try:
            data = _extract_json(raw)
        except json.JSONDecodeError:
            return {"persons": [], "relationships": [], "_raw": raw[:500]}

        # Defer normalisation to gedcomx_service (post-processing dedupe)
        from backend.services.gedcomx_service import _dedupe_persons
        persons = data.get("persons") or []
        rels = data.get("relationships") or []
        # Normalise gender + reference shape
        valid_ids = set()
        for i, p in enumerate(persons):
            if not p.get("id"):
                p["id"] = f"p{i+1}"
            valid_ids.add(p["id"])
            g = (p.get("gender") or {}).get("type", "") if isinstance(p.get("gender"), dict) else str(p.get("gender") or "")
            gl = g.lower()
            if "female" in gl:
                p["gender"] = {"type": "http://gedcomx.org/Female"}
            elif "male" in gl:
                p["gender"] = {"type": "http://gedcomx.org/Male"}
            elif p.get("gender"):
                p.pop("gender", None)
            if not p.get("names"):
                p["names"] = [{"nameForms": [{"fullText": p["id"]}]}]
        cleaned = []
        for r in rels:
            rt = (r.get("type") or "").lower()
            if "parentchild" in rt or "parent-child" in rt or "parent_child" in rt:
                r["type"] = "http://gedcomx.org/ParentChild"
            elif "couple" in rt or "spouse" in rt or "married" in rt:
                r["type"] = "http://gedcomx.org/Couple"
            else:
                continue
            for side in ("person1", "person2"):
                v = r.get(side)
                if isinstance(v, str):
                    r[side] = {"resource": f"#{v.lstrip('#')}"}
                elif isinstance(v, dict) and v.get("resource"):
                    r[side] = {"resource": f"#{v['resource'].lstrip('#')}"}
                else:
                    r[side] = None
            a = (r.get("person1") or {}).get("resource", "").lstrip("#")
            b = (r.get("person2") or {}).get("resource", "").lstrip("#")
            if a in valid_ids and b in valid_ids and a != b:
                cleaned.append(r)
        merged_persons, merged_rels = _dedupe_persons(persons, cleaned)
        return {"persons": merged_persons, "relationships": merged_rels}

    # ── Translation ──
    async def translate_to_english(self, text: str) -> dict:
        prompt = (
            "Detect the language of the text below and translate it to English. "
            "Preserve line breaks. Keep proper nouns (names of people and places) in their "
            "original spelling. Return ONLY this JSON, no markdown: "
            '{"language": "<two-letter code>", "translation": "<text>"}\n\n'
            f"--- TEXT ---\n{text}"
        )
        raw = await self._chat(
            model=settings.model_for_translation,
            messages=[{"role": "user", "content": prompt}],
            json_mode=True,
        )
        try:
            data = _extract_json(raw)
            return {
                "language": (data.get("language") or "und").lower()[:5],
                "translation": (data.get("translation") or "").strip(),
            }
        except json.JSONDecodeError:
            return {"language": "und", "translation": raw.strip()}


# Single shared instance
ai_service = AIService()
