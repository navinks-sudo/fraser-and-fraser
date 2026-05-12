from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import List

class Settings(BaseSettings):
    openai_api_key: str = "ollama"
    openai_base_url: str = "http://localhost:11434/v1"
    openai_model: str = "qwen2.5vl:7b"

    # Gemini — used as OCR fallback and as the IndexGenius (structured extraction) primary
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    jwt_secret: str
    database_url: str = "sqlite+aiosqlite:///./genealogiq.db"
    storage_base: str = "./storage"
    allowed_origins: List[str] = ["http://localhost:5173", "http://localhost:3000"]
    
    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v):
        if isinstance(v, str):
            if v.startswith("["): # Handle JSON list format
                import json
                return json.loads(v)
            return [i.strip() for i in v.split(",")]
        return v

    class Config:
        env_file = ".env"

settings = Settings()
