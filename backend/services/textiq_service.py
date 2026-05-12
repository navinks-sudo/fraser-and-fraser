import base64
import io
import logging
import math
from pathlib import Path
from typing import Iterable, Optional

from PIL import Image as PILImage, ImageFile

from backend.config import settings
from backend.services.openai_service import get_openai_client
from backend.services.gemini_service import GeminiService

log = logging.getLogger(__name__)

ImageFile.LOAD_TRUNCATED_IMAGES = True

_MAX_DIMENSION = 2048
_MIN_REGION_DIMENSION = 800   # min size after upscale for tiny crops


def _open_rgb(image_path: str) -> PILImage.Image:
    if not image_path or not Path(image_path).is_file():
        raise FileNotFoundError(f"Image not found on disk: {image_path}")
    img = PILImage.open(image_path)
    img.load()
    if img.mode in ("RGBA", "LA"):
        bg = PILImage.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode == "P":
        img = img.convert("RGBA")
        bg = PILImage.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")
    return img


def _to_jpeg_data_url(img: PILImage.Image, max_dim: int = _MAX_DIMENSION) -> str:
    work = img.copy()
    if max(work.size) > max_dim:
        work.thumbnail((max_dim, max_dim), PILImage.LANCZOS)
    elif max(work.size) < _MIN_REGION_DIMENSION:
        scale = _MIN_REGION_DIMENSION / max(work.size)
        new_size = (int(work.size[0] * scale), int(work.size[1] * scale))
        work = work.resize(new_size, PILImage.LANCZOS)
    buf = io.BytesIO()
    work.save(buf, format="JPEG", quality=88, optimize=True)
    return f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode()}"


def _build_confidence(token_entries: Iterable[dict]) -> dict:
    """Convert per-token logprobs into text + word/char confidence arrays."""
    chars: list[dict] = []
    words: list[dict] = []
    text_parts: list[str] = []

    word_chars: list[str] = []
    word_confs: list[float] = []
    word_start = 0
    cursor = 0

    def flush():
        nonlocal word_chars, word_confs, word_start
        if word_chars:
            wt = "".join(word_chars)
            log_sum = sum(math.log(max(c, 1e-9)) for c in word_confs)
            wc = math.exp(log_sum / len(word_confs)) if word_confs else 0.0
            words.append({
                "text": wt,
                "conf": round(wc, 4),
                "start": word_start,
                "end": word_start + len(wt),
            })
        word_chars = []
        word_confs = []

    for tok in token_entries:
        tok_text = tok.get("text", "")
        tok_conf = float(tok.get("conf", 1.0))
        text_parts.append(tok_text)
        for ch in tok_text:
            chars.append({"text": ch, "conf": round(tok_conf, 4)})
            if ch.isspace():
                flush()
                word_start = cursor + 1
            else:
                if not word_chars:
                    word_start = cursor
                word_chars.append(ch)
                word_confs.append(tok_conf)
            cursor += 1
    flush()

    full_text = "".join(text_parts)
    avg_conf = (
        round(sum(w["conf"] for w in words) / len(words), 4) if words else None
    )
    low_conf_words = [w for w in words if w["conf"] < 0.7]
    return {
        "text": full_text,
        "words": words,
        "chars": chars,
        "avg_confidence": avg_conf,
        "low_confidence_count": len(low_conf_words),
    }


def _tokens_from_choice(choice) -> list[dict]:
    """Extract [{text, conf}] from an OpenAI choice's logprobs payload, if present."""
    out: list[dict] = []
    lp = getattr(choice, "logprobs", None)
    content = getattr(lp, "content", None) if lp else None
    if not content:
        return out
    for entry in content:
        tok = getattr(entry, "token", None) or (entry.get("token") if isinstance(entry, dict) else None)
        prob = getattr(entry, "logprob", None) if not isinstance(entry, dict) else entry.get("logprob")
        if tok is None or prob is None:
            continue
        out.append({"text": tok, "conf": math.exp(float(prob))})
    return out


class TextIQService:
    def __init__(self):
        self.client = get_openai_client()
        self.model = settings.openai_model
        self.gemini = GeminiService()

    def _prepare_full_image_data_url(self, image_path: str) -> str:
        img = _open_rgb(image_path)
        return _to_jpeg_data_url(img, max_dim=_MAX_DIMENSION)

    def _prepare_region_data_url(self, image_path: str, bbox: list) -> str:
        img = _open_rgb(image_path)
        x1, y1, x2, y2 = [int(v) for v in bbox]
        x1 = max(0, min(x1, img.width))
        x2 = max(0, min(x2, img.width))
        y1 = max(0, min(y1, img.height))
        y2 = max(0, min(y2, img.height))
        if x2 <= x1 or y2 <= y1:
            raise ValueError(f"Invalid bbox: {bbox}")
        crop = img.crop((x1, y1, x2, y2))
        return _to_jpeg_data_url(crop, max_dim=_MAX_DIMENSION)

    async def _ocr_call(self, data_url: str, prompt_text: str, with_logprobs: bool) -> tuple[str, list[dict], Optional[str]]:
        """Returns (text, tokens_with_conf, language_hint_or_none)."""
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt_text},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }]
        kwargs = {"model": self.model, "messages": messages, "max_tokens": 4096}
        if with_logprobs:
            kwargs["logprobs"] = True
            kwargs["top_logprobs"] = 2
        try:
            resp = await self.client.chat.completions.create(**kwargs)
        except TypeError:
            # endpoint doesn't accept logprobs kwargs — retry without
            kwargs.pop("logprobs", None)
            kwargs.pop("top_logprobs", None)
            resp = await self.client.chat.completions.create(**kwargs)

        choice = resp.choices[0]
        text = (choice.message.content or "").strip()
        tokens = _tokens_from_choice(choice)
        return text, tokens, None

    async def perform_ocr(self, image_path: str) -> dict:
        """Page-level OCR with word/char confidence. Ollama (with logprobs) → Gemini fallback.

        Returns a dict shaped like ocr_region's: {text, words, chars, avg_confidence,
        low_confidence_count, confidence_source}. Old callers that expected a plain
        string should now read result['text'].
        """
        prompt = (
            "Please perform OCR on this historical document. "
            "Transcribe every line exactly as it appears, preserving line breaks. "
            "Return ONLY the transcribed text — no commentary, no markdown."
        )
        try:
            data_url = self._prepare_full_image_data_url(image_path)
            text, tokens, _ = await self._ocr_call(data_url, prompt, with_logprobs=True)

            if tokens:
                conf = _build_confidence(tokens)
                conf["text"] = text or conf["text"]
                conf["confidence_source"] = "logprobs"
                return conf

            if text.strip():
                # No logprobs returned — dual-pass diff for confidence.
                second_text, _, _ = await self._ocr_call(data_url, prompt, with_logprobs=False)
                return _dual_pass_confidence(text, second_text)

            log.warning("Primary OCR returned empty; falling back to Gemini")
        except Exception as e:
            log.warning("Primary OCR failed (%s); falling back to Gemini", e)

        if not self.gemini.is_configured:
            raise RuntimeError("Primary OCR failed and Gemini fallback is not configured.")

        gemini_text = await self.gemini.ocr_image(image_path)
        return _flat_confidence(gemini_text, source="gemini", base_conf=0.85)

    async def ocr_region(self, image_path: str, bbox: list) -> dict:
        """OCR a single bounding-box crop. Ollama (with logprobs) → Gemini fallback."""
        prompt = (
            "Transcribe this short genealogical record entry exactly as written, "
            "preserving line breaks. Then return ONLY the transcription — no commentary, "
            "no markdown, no headers."
        )
        try:
            data_url = self._prepare_region_data_url(image_path, bbox)
            text, tokens, _ = await self._ocr_call(data_url, prompt, with_logprobs=True)

            if tokens:
                confidence = _build_confidence(tokens)
                confidence["text"] = text or confidence["text"]
                confidence["confidence_source"] = "logprobs"
                return confidence

            if text.strip():
                # Same primary endpoint, no logprobs available — dual-pass diff.
                second_text, _, _ = await self._ocr_call(data_url, prompt, with_logprobs=False)
                return _dual_pass_confidence(text, second_text)

            log.warning("Primary region OCR returned empty; falling back to Gemini")
        except Exception as e:
            log.warning("Primary region OCR failed (%s); falling back to Gemini", e)

        if not self.gemini.is_configured:
            raise RuntimeError("Primary OCR failed and Gemini fallback is not configured.")

        gemini_text = await self.gemini.ocr_image(image_path, bbox=bbox)
        return _flat_confidence(gemini_text, source="gemini", base_conf=0.85)


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
