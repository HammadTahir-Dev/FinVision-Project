"""
database.py — PostgreSQL connection setup using SQLAlchemy.
Provides the engine, session factory, and Base for all models.
"""

from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator
import logging

from config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# ── Engine ────────────────────────────────────────────────────────────────────
# pool_pre_ping=True checks connection health before using from pool
# This prevents "connection closed" errors after idle periods
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    echo=settings.debug,  # logs all SQL when DEBUG=True
)

# ── Session Factory ───────────────────────────────────────────────────────────
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

# ── Base Class for all Models ─────────────────────────────────────────────────
Base = declarative_base()


# ── Dependency ────────────────────────────────────────────────────────────────
def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that provides a database session per request.
    Always closes the session after the request, even on error.

    Usage in a router:
        @router.get("/items")
        def get_items(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_db_connection() -> dict:
    """
    Health check — verifies the database is reachable.
    Returns status dict used by the /health endpoint.
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "healthy", "detail": "PostgreSQL connected"}
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return {"status": "unhealthy", "detail": str(e)}


def create_all_tables():
    """
    Creates all tables defined in models/ that haven't been created yet.
    Called once at application startup.
    Safe to call multiple times — skips existing tables.
    """
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("✅ Database tables created/verified successfully")
    except Exception as e:
        logger.error(f"❌ Failed to create database tables: {e}")
        raise
