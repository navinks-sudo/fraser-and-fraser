"""OCR — delegates to ai_service which uses the OpenAI SDK against whatever
endpoint .env points at.
"""
import logging
from typing import Iterable
from backend.services.ai_service import ai_service

log = logging.getLogger(__name__)


def _flat_confidence(text: str, source: str = "openai", base_conf: float = 0.92) -> dict:
    words, chars = [], []
    cursor = 0
    parts = (text or "").split()
    for i, tok in enumerate(parts):
        words.append({"text": tok, "conf": base_conf, "start": cursor, "end": cursor + len(tok)})
        for ch in tok:
            chars.append({"text": ch, "conf": base_conf})
        cursor += len(tok)
        if i < len(parts) - 1:
            chars.append({"text": " ", "conf": 1.0})
            cursor += 1
    return {
        "text": text or "",
        "words": words,
        "chars": chars,
        "avg_confidence": base_conf if words else None,
        "low_confidence_count": 0,
        "confidence_source": source,
    }


def _dual_pass_confidence(text_a: str, text_b: str) -> dict:
    words_a = (text_a or "").split()
    words_b_set = set((text_b or "").split())
    words, chars, rebuilt = [], [], []
    cursor = 0
    for i, w in enumerate(words_a):
        conf = 0.95 if w in words_b_set else 0.55
        words.append({"text": w, "conf": conf, "start": cursor, "end": cursor + len(w)})
        for ch in w:
            chars.append({"text": ch, "conf": conf})
        rebuilt.append(w)
        if i < len(words_a) - 1:
            chars.append({"text": " ", "conf": 1.0})
            cursor += len(w) + 1
            rebuilt.append(" ")
        else:
            cursor += len(w)
    avg = round(sum(w["conf"] for w in words) / len(words), 4) if words else None
    return {
        "text": "".join(rebuilt) or text_a,
        "words": words,
        "chars": chars,
        "avg_confidence": avg,
        "low_confidence_count": sum(1 for w in words if w["conf"] < 0.7),
        "confidence_source": "dual_pass",
    }


class TextIQService:
    def __init__(self):
        self.ai = ai_service

    async def perform_ocr(self, image_path: str) -> dict:
        text = await self.ai.ocr_image(image_path)
        return _flat_confidence(text)

    async def ocr_region(self, image_path: str, bbox: list) -> dict:
        first = await self.ai.ocr_image(image_path, bbox=bbox)
        if not first.strip():
            return _flat_confidence("", base_conf=0.0)
        try:
            second = await self.ai.ocr_image(image_path, bbox=bbox)
            return _dual_pass_confidence(first, second)
        except Exception as e:
            log.warning("Second-pass OCR failed (%s); using flat confidence", e)
            return _flat_confidence(first)
