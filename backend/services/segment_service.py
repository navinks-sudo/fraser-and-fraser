"""Region detection — delegates to ai_service (OpenAI SDK, env-driven)."""
from backend.services.ai_service import ai_service


class SegmentService:
    async def detect_regions(self, image_path: str) -> dict:
        return await ai_service.detect_regions(image_path)
