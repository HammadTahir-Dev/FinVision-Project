"""
config.py — Central configuration for FinVision backend.
Loads all settings from the .env file using pydantic-settings.
"""

from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
from pathlib import Path


class Settings(BaseSettings):
    # ── App ───────────────────────────────────────────────────────────────────
    app_name: str = "FinVision"
    debug: bool = True
    allowed_origins: str = "http://localhost:5173,http://localhost:3000"

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str

    # ── Groq API ──────────────────────────────────────────────────────────────
    groq_api_key: str

    # ── JWT Auth ──────────────────────────────────────────────────────────────
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24 hours

    # ── File Storage ──────────────────────────────────────────────────────────
    upload_dir: str = "./uploads"
    chroma_dir: str = "./chroma_db"

    # ── LLM / RAG Settings (editable by Supervisor) ───────────────────────────
    default_llm_model: str = "llama-3.1-8b-instant"
    default_embedding_model: str = "all-MiniLM-L6-v2"
    default_temperature: float = 0.35
    default_max_tokens: int = 2048
    default_chunk_size: int = 512
    default_chunk_overlap: int = 50
    default_k_value: int = 6

    @field_validator("allowed_origins")
    @classmethod
    def parse_origins(cls, v: str) -> str:
        return v  # kept as string; parsed into list in main.py

    def get_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    def ensure_dirs(self):
        """Create upload and chroma directories if they don't exist."""
        Path(self.upload_dir).mkdir(parents=True, exist_ok=True)
        Path(self.chroma_dir).mkdir(parents=True, exist_ok=True)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """
    Returns a cached Settings instance.
    Use as a FastAPI dependency: settings = Depends(get_settings)
    """
    return Settings()
