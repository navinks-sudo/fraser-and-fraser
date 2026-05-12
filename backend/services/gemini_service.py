"""Gemini integration — used as OCR fallback and as the structured-extraction primary."""
import asyncio
import base64
import io
import json
import logging
import re
import time
from pathlib import Path
from typing import Optional

from PIL import Image as PILImage, ImageFile

from backend.config import settings

log = logging.getLogger(__name__)


def _generate_with_retry(client, *, model: str, contents, config=None, max_retries: int = 3):
    """Call gemini.generate_content with retries on transient 503/429.

    Gemini returns 503 UNAVAILABLE when the model is overloaded, and 429
    RESOURCE_EXHAUSTED when the per-minute quota is hit. Both are recoverable
    with a short backoff.
    """
    delay = 2.0
    last_exc = None
    for attempt in range(max_retries):
        try:
            return client.models.generate_content(model=model, contents=contents, config=config or {})
        except Exception as e:  # google.genai exposes ClientError + ServerError
            text = str(e)
            transient = (
                "503" in text
                or "UNAVAILABLE" in text
                or "429" in text
                or "RESOURCE_EXHAUSTED" in text
                or "overloaded" in text.lower()
            )
            if not transient or attempt == max_retries - 1:
                last_exc = e
                break
            log.warning("Gemini transient error (%s) — retrying in %.1fs (attempt %d/%d)",
                        type(e).__name__, delay, attempt + 1, max_retries)
            time.sleep(delay)
            delay *= 2.0
    raise last_exc

ImageFile.LOAD_TRUNCATED_IMAGES = True

_MAX_DIMENSION = 2048


def _get_genai_client():
    """Lazy-import + initialise the google-genai client. Raises if no key configured."""
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set in .env")
    from google import genai
    return genai.Client(api_key=settings.gemini_api_key)


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


def _encode_jpeg(img: PILImage.Image, max_dim: int = _MAX_DIMENSION) -> bytes:
    work = img.copy()
    if max(work.size) > max_dim:
        work.thumbnail((max_dim, max_dim), PILImage.LANCZOS)
    buf = io.BytesIO()
    work.save(buf, format="JPEG", quality=88, optimize=True)
    return buf.getvalue()


def _extract_json(raw: str):
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    m = re.search(r"\{.*\}", text, re.DOTALL) or re.search(r"\[.*\]", text, re.DOTALL)
    if m:
        text = m.group(0)
    return json.loads(text)


def _normalise_gedcomx(data: dict) -> dict:
    """Defensive cleanup of Gemini's GedcomX output."""
    persons = data.get("persons") or []
    rels = data.get("relationships") or []

    # Make sure every person has an id; collect valid ids
    valid_ids = set()
    for i, p in enumerate(persons, start=1):
        if not p.get("id"):
            p["id"] = f"p{i}"
        valid_ids.add(p["id"])

        # Normalise gender
        g = (p.get("gender") or {}).get("type", "") if isinstance(p.get("gender"), dict) else str(p.get("gender") or "")
        gl = g.lower()
        if "female" in gl:
            p["gender"] = {"type": "http://gedcomx.org/Female"}
        elif "male" in gl:
            p["gender"] = {"type": "http://gedcomx.org/Male"}
        elif p.get("gender"):
            p.pop("gender", None)

        # Make sure names list exists
        if not p.get("names"):
            p["names"] = [{"nameForms": [{"fullText": p.get("id")}]}]

    # Normalise relationships
    cleaned_rels = []
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
                ref = v.lstrip("#")
                r[side] = {"resource": f"#{ref}"}
            elif isinstance(v, dict) and v.get("resource"):
                ref = v["resource"].lstrip("#")
                r[side] = {"resource": f"#{ref}"}
            else:
                r[side] = None

        a = (r.get("person1") or {}).get("resource", "").lstrip("#")
        b = (r.get("person2") or {}).get("resource", "").lstrip("#")
        if a in valid_ids and b in valid_ids and a != b:
            cleaned_rels.append(r)

    # Fuzzy-merge persons whose names are token-subsets (e.g. "Joelty" → "Joelty Boul")
    from backend.services.gedcomx_service import _dedupe_persons
    merged_persons, merged_rels = _dedupe_persons(persons, cleaned_rels)
    return {"persons": merged_persons, "relationships": merged_rels}


class GeminiService:
    def __init__(self):
        self.model = settings.gemini_model

    @property
    def is_configured(self) -> bool:
        return bool(settings.gemini_api_key)

    # ----------------- Vision OCR -----------------

    async def ocr_image(self, image_path: str, bbox: Optional[list] = None) -> str:
        """OCR an image (or a bbox crop). Returns plain transcribed text."""
        img = _open_rgb(image_path)
        if bbox and len(bbox) == 4:
            x1, y1, x2, y2 = [int(v) for v in bbox]
            x1 = max(0, min(x1, img.width))
            x2 = max(0, min(x2, img.width))
            y1 = max(0, min(y1, img.height))
            y2 = max(0, min(y2, img.height))
            if x2 > x1 and y2 > y1:
                img = img.crop((x1, y1, x2, y2))

        jpeg_bytes = _encode_jpeg(img)
        prompt = (
            "Perform OCR on this historical document. "
            "Transcribe every line exactly as it appears, preserving line breaks. "
            "Return ONLY the transcribed text — no commentary, no markdown."
        )

        def _call():
            client = _get_genai_client()
            from google.genai import types
            return _generate_with_retry(
                client,
                model=self.model,
                contents=[
                    types.Part.from_bytes(data=jpeg_bytes, mime_type="image/jpeg"),
                    prompt,
                ],
            )

        resp = await asyncio.to_thread(_call)
        return (resp.text or "").strip()

    # ----------------- Structured extraction -----------------

    async def extract_genealogy_record(self, text: str) -> dict:
        """Extract structured genealogy fields from OCR text.

        Open-ended: returns the standard fields when present, every person and
        relation discovered, every other piece of metadata in the document, and
        a self-rated confidence value (0-1) for each field, person, relation,
        and metadata entry.
        """
        schema_instructions = (
            "You are extracting structured genealogy data from a historical record. "
            "Be exhaustive — capture EVERY datum the document contains, not just the "
            "predefined slots. For each datum, also rate your own confidence on 0-1.\n\n"
            "Return ONLY a JSON object with this EXACT shape — NO markdown, NO commentary:\n"
            "{\n"
            '  "record_number": "string or null",\n'
            '  "event_type": "birth | death | marriage | baptism | burial | other | null",\n'
            '  "given_name": "string or null",\n'
            '  "surname":    "string or null",\n'
            '  "date_of_birth": "string or null (preserve original format)",\n'
            '  "date_of_death": "string or null",\n'
            '  "date_of_event": "string or null",\n'
            '  "place_of_event": "string or null",\n'
            '  "father_name": "string or null",\n'
            '  "mother_name": "string or null",\n'
            '  "family_members": [{"name": "string", "relation": "string as written"}],\n'
            '  "persons": [\n'
            '    {\n'
            '      "name": "FULL NAME — combine surname and given name intelligently",\n'
            '      "gender": "M | F | U",\n'
            '      "role": "subject | father | mother | spouse | child | godfather | godmother | witness | priest | officiant | informant | other",\n'
            '      "age": "string or null",\n'
            '      "date_of_birth": "string or null",\n'
            '      "date_of_death": "string or null",\n'
            '      "occupation": "string or null",\n'
            '      "place": "string or null",\n'
            '      "confidence": 0.0-1.0\n'
            '    }\n'
            '  ],\n'
            '  "relations": [\n'
            '    {\n'
            '      "person_a": "name as in persons[]",\n'
            '      "person_b": "name as in persons[]",\n'
            '      "type":     "parent_of | child_of | spouse_of | sibling_of | godparent_of | witness_of | other",\n'
            '      "confidence": 0.0-1.0\n'
            '    }\n'
            '  ],\n'
            '  "metadata": [\n'
            '    {\n'
            '      "label":      "human-readable label of the datum (e.g. \\"Place of baptism\\", \\"Father\'s occupation\\", \\"Witness 1\\", \\"Officiant\\", \\"Civil status\\", \\"Page number\\", \\"Diocese\\", \\"Town\\", \\"Notary\\", \\"Marriage settlement\\")",\n'
            '      "value":      "extracted value as written",\n'
            '      "category":   "date | place | name | occupation | age | civil_status | religious | event | identifier | language | military | medical | other",\n'
            '      "confidence": 0.0-1.0,\n'
            '      "notes":      "optional clarifying note or null"\n'
            '    }\n'
            '  ],\n'
            '  "field_confidences": {\n'
            '    "given_name": 0.0-1.0,\n'
            '    "surname": 0.0-1.0,\n'
            '    "father_name": 0.0-1.0,\n'
            '    "mother_name": 0.0-1.0,\n'
            '    "date_of_event": 0.0-1.0,\n'
            '    "place_of_event": 0.0-1.0,\n'
            '    "event_type": 0.0-1.0\n'
            "  },\n"
            '  "additional_info": {}\n'
            "}\n\n"
            "EXTRACTION RULES:\n"
            "1. persons[] must include EVERY human mentioned in the text. Infer gender from "
            "   the name and the role.\n"
            "2. Compose full names intelligently. 'Calineau Jacques' or 'Jacques Calineau' → "
            "   one person 'Jacques Calineau'. Never split surname and given-name into two persons.\n"
            "3. relations[] lists every kinship link. 'parent_of' has person_a as parent.\n"
            "4. metadata[] is OPEN-ENDED. Capture every interesting datum that doesn't fit the "
            "   standard slots — page numbers, witness names, occupations, ages, civil status, "
            "   places, religious details, military service, medical notes, dialectal variations, "
            "   Latin/French/Spanish/etc. text fragments, signatures, marginal notes, archival "
            "   identifiers — anything a genealogist would want to know.\n"
            "5. Confidence: 1.0 = clearly written and unambiguous, 0.7 = legible with minor doubt, "
            "   0.4 = poorly legible / inferred, 0.2 = guess. Be honest about uncertainty.\n"
            "6. Don't invent people or facts not implied by the text.\n"
        )

        full_prompt = f"{schema_instructions}\n--- TEXT ---\n{text}"

        def _call():
            client = _get_genai_client()
            return _generate_with_retry(
                client,
                model=self.model,
                contents=[full_prompt],
                config={"response_mime_type": "application/json"},
            )

        resp = await asyncio.to_thread(_call)
        raw = resp.text or ""
        try:
            return _extract_json(raw)
        except json.JSONDecodeError:
            return {
                "record_number": None, "event_type": None,
                "given_name": None, "surname": None,
                "date_of_birth": None, "date_of_death": None, "date_of_event": None,
                "place_of_event": None,
                "father_name": None, "mother_name": None,
                "family_members": [], "persons": [], "relations": [],
                "metadata": [], "field_confidences": {},
                "additional_info": {"_raw": raw[:500]},
            }

    # ----------------- Spreadsheet → genealogy graph -----------------

    async def extract_from_spreadsheet(self, sheets: list, max_rows: int = 150) -> dict:
        """Given parsed spreadsheet sheets, ask Gemini to derive persons + relations
        directly from the tabular data (no OCR text intermediate step).

        Returns a RecordExtraction-compatible dict with persons[], relations[],
        metadata[] populated from the rows.
        """
        # Trim aggressively — Gemini context budget is finite and a 25k-row
        # spreadsheet will return 502/timeout. The 'truncated' flag tells the
        # caller to surface a warning.
        total_rows = sum(len(s.get("rows") or []) for s in (sheets or []))
        compact = []
        truncated = False
        for sheet in (sheets or []):
            rows = sheet.get("rows") or []
            if len(rows) > max_rows:
                truncated = True
            compact.append({
                "name": sheet.get("name"),
                "columns": sheet.get("columns") or [],
                "rows": rows[:max_rows],
                "truncated_to": max_rows if len(rows) > max_rows else None,
                "total_rows_in_sheet": len(rows),
            })

        instructions = (
            "You are extracting genealogy data from a spreadsheet. Each sheet has columns and "
            "rows; each row typically describes a person or an event involving people.\n\n"
            "Identify EVERY person mentioned across all rows. Compose full names from any "
            "given/surname columns. Infer gender from name and role columns. Identify every "
            "kinship link: parent_of, child_of, spouse_of, sibling_of, etc. Capture every "
            "interesting cell value as metadata.\n\n"
            "Return ONLY this JSON shape (no markdown, no commentary):\n"
            "{\n"
            '  "persons": [\n'
            '    {"name":"...","gender":"M|F|U","role":"...","age":"...","date_of_birth":"...",\n'
            '     "date_of_death":"...","occupation":"...","place":"...","confidence":0.0-1.0}\n'
            '  ],\n'
            '  "relations": [\n'
            '    {"person_a":"name","person_b":"name","type":"parent_of|child_of|spouse_of|sibling_of|other","confidence":0.0-1.0}\n'
            '  ],\n'
            '  "metadata": [\n'
            '    {"label":"...","value":"...","category":"date|place|name|occupation|other","confidence":0.0-1.0,"notes":null}\n'
            "  ]\n"
            "}\n\n"
            "Names must be consistent — same person spelled identically in persons[] and relations[].\n"
            "Confidence: 1.0 for cell values plainly given, 0.7 for inferred, 0.3 for guessed.\n"
        )

        prompt = f"{instructions}\n--- SHEETS ---\n{json.dumps(compact, ensure_ascii=False, indent=2)}"

        def _call():
            client = _get_genai_client()
            return _generate_with_retry(
                client,
                model=self.model,
                contents=[prompt],
                config={"response_mime_type": "application/json"},
            )

        resp = await asyncio.to_thread(_call)
        raw = resp.text or ""
        try:
            data = _extract_json(raw)
        except json.JSONDecodeError:
            data = {"persons": [], "relations": [], "metadata": [], "additional_info": {"_raw": raw[:500]}}

        # Surface truncation so the UI can warn the user
        if truncated:
            info = data.get("additional_info") or {}
            info["truncated"] = True
            info["total_rows_in_file"] = total_rows
            info["rows_sent_to_ai"] = sum(min(len(s.get("rows") or []), max_rows) for s in (sheets or []))
            data["additional_info"] = info
        return data

    # ----------------- Family-tree synthesis (cross-record) -----------------

    async def build_family_tree(self, records: list, ocr_blobs: list | None = None) -> dict:
        """Build a unified GedcomX family tree across many records.

        Asks Gemini to dedupe persons across records (same person mentioned in
        multiple documents = ONE node), infer parent/child/spouse relationships,
        and emit a clean GedcomX graph.

        ``records`` is a list of dicts (the IndexGenius extraction output).
        ``ocr_blobs`` is an optional list of {image_id, region_index, text} for
        extra context (full OCR text); kept short to fit the prompt.
        """
        if not records:
            return {"persons": [], "relationships": []}

        # Trim each record to only the fields we need, keeping the prompt compact.
        trimmed = []
        for idx, r in enumerate(records, start=1):
            trimmed.append({
                "record_index": idx,
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
            })

        records_json = json.dumps(trimmed, ensure_ascii=False, indent=2)

        prompt = (
            "You are analysing extracted historical genealogy records. Below is a JSON array "
            "of records — each one was extracted from a separate document or page region.\n\n"
            "TASK:\n"
            "1. Identify every UNIQUE person mentioned across ALL records. Two mentions of the "
            "   same name (e.g. 'Marcel Calineau' and 'Marcel CALINEAU' or 'Marie Leclerc' and "
            "   'Marie LECLERC') are the SAME person — merge them.\n"
            "2. Use clues like dates, places, and parent names to disambiguate (two 'Jean Dupont's "
            "   with different fathers are different people).\n"
            "3. Identify every relationship:\n"
            "   - ParentChild: person1 is parent of person2\n"
            "   - Couple: spouses (use ParentChild siblings or 'married to' clues)\n"
            "4. Mark gender ('Male' / 'Female') based on names and roles when possible.\n"
            "5. Mark `principal=true` ONLY for the named subject of a record (the person the "
            "   record is primarily about). Most parents and family members are not principal.\n\n"
            "OUTPUT FORMAT — return ONLY this GedcomX-shaped JSON, no markdown, no prose:\n"
            "{\n"
            '  "persons": [\n'
            '    {\n'
            '      "id": "p1",\n'
            '      "names": [{"nameForms": [{"fullText": "Jacques Calineau"}]}],\n'
            '      "gender": {"type": "http://gedcomx.org/Male"},\n'
            '      "principal": true,\n'
            '      "facts": [\n'
            '        {"type": "http://gedcomx.org/Birth",\n'
            '         "date": {"original": "15 mars 1876"},\n'
            '         "place": {"original": "Angers"}}\n'
            '      ]\n'
            '    }\n'
            '  ],\n'
            '  "relationships": [\n'
            '    {"type": "http://gedcomx.org/ParentChild",\n'
            '     "person1": {"resource": "#p2"},\n'
            '     "person2": {"resource": "#p1"}},\n'
            '    {"type": "http://gedcomx.org/Couple",\n'
            '     "person1": {"resource": "#p2"},\n'
            '     "person2": {"resource": "#p3"}}\n'
            '  ]\n'
            "}\n\n"
            "RULES:\n"
            "- person1 in ParentChild is the PARENT, person2 is the CHILD.\n"
            "- Resource IDs always start with '#'.\n"
            "- Gender URLs: 'http://gedcomx.org/Male', 'http://gedcomx.org/Female'.\n"
            "- Type URLs: 'http://gedcomx.org/ParentChild', 'http://gedcomx.org/Couple'.\n"
            "- Don't invent people not implied by the data.\n"
            "- Always emit ParentChild for every parent of every child you can determine.\n\n"
            f"RECORDS:\n{records_json}\n"
        )

        def _call():
            client = _get_genai_client()
            return _generate_with_retry(
                client,
                model=self.model,
                contents=[prompt],
                config={"response_mime_type": "application/json"},
            )

        resp = await asyncio.to_thread(_call)
        raw = resp.text or ""
        try:
            data = _extract_json(raw)
        except json.JSONDecodeError:
            return {"persons": [], "relationships": [], "_raw": raw[:500]}

        return _normalise_gedcomx(data)

    # ----------------- Translation -----------------

    async def translate_to_english(self, text: str) -> dict:
        prompt = (
            "Detect the language of the text below and translate it to English. "
            "Preserve line breaks. Keep proper nouns (names of people and places) in their "
            "original spelling. Return ONLY a JSON object: "
            '{"language": "<two-letter code>", "translation": "<english text>"}\n\n'
            f"--- TEXT ---\n{text}"
        )

        def _call():
            client = _get_genai_client()
            return _generate_with_retry(
                client,
                model=self.model,
                contents=[prompt],
            )

        resp = await asyncio.to_thread(_call)
        raw = resp.text or ""
        try:
            data = _extract_json(raw)
            return {
                "language": (data.get("language") or "und").lower()[:5],
                "translation": (data.get("translation") or "").strip(),
            }
        except json.JSONDecodeError:
            return {"language": "und", "translation": raw.strip()}
