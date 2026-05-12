import json
import re
from typing import Optional

from backend.config import settings
from backend.services.openai_service import get_openai_client


def _extract_json(raw: str) -> dict:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        text = m.group(0)
    return json.loads(text)


class TranslationService:
    def __init__(self):
        self.client = get_openai_client()
        self.model = settings.openai_model

    async def translate_to_english(self, text: str, source_lang: Optional[str] = None) -> dict:
        """Detects the source language and translates to English.

        Returns {"language": "<bcp47>", "translation": "<text>"}.
        """
        source_hint = f"Source language hint: {source_lang}.\n" if source_lang else ""
        prompt = (
            "Detect the language of the text below and translate it to English. "
            "Preserve line breaks. Keep proper nouns (names of people and places) in their "
            "original spelling. Return ONLY a JSON object with this shape, no markdown:\n"
            '{"language": "<two-letter language code>", "translation": "<english text>"}\n\n'
            f"{source_hint}--- TEXT ---\n{text}"
        )

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4096,
        )
        raw = response.choices[0].message.content or ""
        try:
            data = _extract_json(raw)
        except json.JSONDecodeError:
            return {"language": (source_lang or "und"), "translation": raw.strip()}

        lang = (data.get("language") or "und").strip().lower()[:5]
        translation = (data.get("translation") or "").strip()
        return {"language": lang, "translation": translation}
