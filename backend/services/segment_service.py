"""Detects bounding boxes for individual genealogical records on a page.

Uses Gemini vision. Returns regions in the *original* image's pixel
coordinates so the frontend can overlay them on the un-resized file.
"""
import asyncio
import io
import json
import re
from pathlib import Path
from typing import Tuple

from PIL import Image as PILImage, ImageFile

from backend.config import settings
from backend.services.gemini_service import _get_genai_client, _generate_with_retry

ImageFile.LOAD_TRUNCATED_IMAGES = True

_MAX_DIMENSION = 2048


class SegmentService:
    def __init__(self):
        self.model = settings.gemini_model

    def _prepare_image(self, image_path: str) -> Tuple[bytes, Tuple[int, int], Tuple[int, int]]:
        """Open + normalise + downsize the image. Returns (jpeg_bytes, orig_size, sent_size)."""
        if not image_path or not Path(image_path).is_file():
            raise FileNotFoundError(f"Image not found on disk: {image_path}")

        with PILImage.open(image_path) as img:
            img.load()
            orig_size = img.size

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

            if max(img.size) > _MAX_DIMENSION:
                img.thumbnail((_MAX_DIMENSION, _MAX_DIMENSION), PILImage.LANCZOS)
            sent_size = img.size

            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=88, optimize=True)
            return buf.getvalue(), orig_size, sent_size

    @staticmethod
    def _extract_json(raw: str) -> dict:
        text = (raw or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            text = m.group(0)
        return json.loads(text)

    async def detect_regions(self, image_path: str) -> dict:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured.")

        jpeg_bytes, orig_size, sent_size = self._prepare_image(image_path)

        prompt = (
            "You are analysing a scan of a historical record book (parish register, civil "
            "register, census, etc.). Identify each separate record entry on this page. "
            "A record is one self-contained block — typically one birth/marriage/death/"
            "baptism/burial event for one person or one family group.\n\n"
            f"The image you are seeing is {sent_size[0]} x {sent_size[1]} pixels. "
            "Return bounding boxes as [x1, y1, x2, y2] in those pixel coordinates. "
            "Do not include the page header, margins or signatures unless they belong "
            "to a record.\n\n"
            "Return ONLY this JSON object, no markdown, no commentary:\n"
            '{"regions": [{"index": 1, "bbox": [x1,y1,x2,y2], '
            '"summary": "Birth of <name>", "language": "fr"}]}'
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
                config={"response_mime_type": "application/json"},
            )

        resp = await asyncio.to_thread(_call)
        raw = (resp.text or "").strip()
        data = self._extract_json(raw)
        regions = data.get("regions") or []

        # Map coords from sent image-space back to original-resolution.
        sx = orig_size[0] / sent_size[0] if sent_size[0] else 1
        sy = orig_size[1] / sent_size[1] if sent_size[1] else 1
        cleaned = []
        for idx, r in enumerate(regions, start=1):
            bb = r.get("bbox") or []
            if len(bb) != 4:
                continue
            x1, y1, x2, y2 = bb
            x1, x2 = sorted([max(0, x1), min(sent_size[0], x2)])
            y1, y2 = sorted([max(0, y1), min(sent_size[1], y2)])
            cleaned.append({
                "index": int(r.get("index") or idx),
                "bbox": [
                    round(x1 * sx),
                    round(y1 * sy),
                    round(x2 * sx),
                    round(y2 * sy),
                ],
                "summary": (r.get("summary") or "").strip(),
                "language": (r.get("language") or "").strip().lower() or None,
            })

        return {
            "regions": cleaned,
            "image_width": orig_size[0],
            "image_height": orig_size[1],
        }
