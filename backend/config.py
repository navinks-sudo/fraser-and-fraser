"""All runtime configuration lives in .env.

Every AI knob is exposed as an env var so the deployment can re-target the
pipeline (e.g. swap between OpenAI, Gemini's openai-compatible endpoint, or
any other OpenAI-compatible host) without code changes.
"""
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── OpenAI-compatible AI endpoint ──
    # API key (string)
    openai_api_key: str = "ollama"
    # Base URL (e.g. https://api.openai.com/v1, http://localhost:11434/v1,
    # https://generativelanguage.googleapis.com/v1beta/openai/)
    openai_base_url: str = "http://localhost:11434/v1"
    # Per-stage model names — separate so OCR can use a vision model while
    # extraction uses a text model, etc. Default is one model for everything.
    openai_default_model: str = "gpt-4o-mini"
    openai_vision_model: str = ""           # falls back to default
    openai_extraction_model: str = ""       # falls back to default
    openai_tree_model: str = ""             # falls back to default
    openai_translation_model: str = ""      # falls back to default
    # Inference knobs
    openai_temperature: float = 0.1
    openai_max_tokens: int = 4096
    openai_timeout: float = 600.0           # seconds; long enough for big extractions
    openai_max_retries: int = 3

    # Legacy (no longer used directly but kept so old .env files don't break)
    openai_model: str = ""
    gemini_api_key: str = ""
    gemini_model: str = ""

    # ── App ──
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    # How long an issued access token stays valid (minutes)
    access_token_expire_minutes: int = 60 * 24  # 24h default
    database_url: str = "sqlite+aiosqlite:///./genealogiq.db"
    storage_base: str = "./storage"
    allowed_origins: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v):
        if isinstance(v, str):
            if v.startswith("["):
                import json
                return json.loads(v)
            return [i.strip() for i in v.split(",")]
        return v

    # ── Convenience accessors with cascading fallback ──
    @property
    def model_for_vision(self) -> str:
        return self.openai_vision_model or self.openai_default_model or self.openai_model

    @property
    def model_for_extraction(self) -> str:
        return self.openai_extraction_model or self.openai_default_model or self.openai_model

    @property
    def model_for_tree(self) -> str:
        return self.openai_tree_model or self.openai_default_model or self.openai_model

    @property
    def model_for_translation(self) -> str:
        return self.openai_translation_model or self.openai_default_model or self.openai_model

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
