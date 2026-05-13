import logging
from pathlib import Path
from typing import Iterable

from PIL import ImageFile

from backend.services.gemini_service import GeminiService

log = logging.getLogger(__name__)

ImageFile.LOAD_TRUNCATED_IMAGES = True


class TextIQService:
    """All OCR runs through Gemini. There's no longer a local Ollama path —
    every transcribe-text call goes to ``GeminiService.ocr_image``.
    """

    def __init__(self):
        self.gemini = GeminiService()

    async def perform_ocr(self, image_path: str) -> dict:
        """Page-level OCR via Gemini.

        Returns {text, words, chars, avg_confidence, low_confidence_count,
        confidence_source}. Confidence is uniform (Gemini doesn't expose
        per-token logprobs) — set to 0.92 by default since Gemini-2.5 is
        very strong on archival documents.
        """
        if not self.gemini.is_configured:
            raise RuntimeError("GEMINI_API_KEY is not configured.")
        text = await self.gemini.ocr_image(image_path)
        return _flat_confidence(text, source="gemini", base_conf=0.92)

    async def ocr_region(self, image_path: str, bbox: list) -> dict:
        """OCR a single region (bbox crop) via Gemini, with dual-pass word confidence.

        Runs Gemini twice on the same crop and diffs at word level — words that
        appear in both passes get high confidence, words that differ get low. This
        catches the ambiguous handwriting cases without needing token logprobs.
        """
        if not self.gemini.is_configured:
            raise RuntimeError("GEMINI_API_KEY is not configured.")

        first_pass = await self.gemini.ocr_image(image_path, bbox=bbox)
        if not first_pass.strip():
            return _flat_confidence("", source="gemini", base_conf=0.0)

        # Second pass for dual-pass diff. If it errors, just return a flat-confidence
        # version of the first pass so the user still gets text.
        try:
            second_pass = await self.gemini.ocr_image(image_path, bbox=bbox)
        except Exception as e:
            log.warning("Second-pass OCR failed (%s); using flat confidence", e)
            return _flat_confidence(first_pass, source="gemini", base_conf=0.92)

        return _dual_pass_confidence(first_pass, second_pass)


def _flat_confidence(text: str, source: str, base_conf: float = 0.85) -> dict:
    """Build a uniform-confidence structure for sources without logprobs (e.g. Gemini)."""
    words: list = []
    chars: list = []
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
    words: list[dict] = []
    chars: list[dict] = []
    cursor = 0
    rebuilt = []

    for i, w in enumerate(words_a):
        conf = 0.95 if w in words_b_set else 0.55
        words.append({
            "text": w,
            "conf": conf,
            "start": cursor,
            "end": cursor + len(w),
        })
        for ch in w:
            chars.append({"text": ch, "conf": conf})
        rebuilt.append(w)
        if i < len(words_a) - 1:
            chars.append({"text": " ", "conf": 1.0})
            cursor += len(w) + 1
            rebuilt.append(" ")
        else:
            cursor += len(w)

    avg_conf = round(sum(w["conf"] for w in words) / len(words), 4) if words else None
    return {
        "text": "".join(rebuilt) or text_a,
        "words": words,
        "chars": chars,
        "avg_confidence": avg_conf,
        "low_confidence_count": sum(1 for w in words if w["conf"] < 0.7),
        "confidence_source": "dual_pass",
    }
