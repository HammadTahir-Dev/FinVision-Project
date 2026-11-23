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
def _normalize_db_url(url: str) -> str:
    """
    SQLAlchemy 2.1+ maps plain 'postgresql://' to the psycopg (v3) driver, but
    requirements.txt installs psycopg2-binary. Pin the driver explicitly so the
    app starts on both old and new SQLAlchemy versions.
    """
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        try:
            import psycopg2  # noqa: F401
            url = "postgresql+psycopg2://" + url[len("postgresql://"):]
        except ImportError:
            pass
    return url


DATABASE_URL = _normalize_db_url(settings.database_url)

engine = create_engine(
    DATABASE_URL,
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


def upgrade_schema():
    """
    Add columns introduced after the first release to existing databases.
    (create_all() makes new tables but never adds columns to existing ones.)
    Safe to run on every start.
    """
    from sqlalchemy import text, inspect
    additions = {"chat_messages": {"chart": "JSON"}}
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in additions.items():
            if not insp.has_table(table):
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for col, sqltype in cols.items():
                if col not in existing:
                    conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {col} {sqltype}'))
                    logger.info(f"Added column {table}.{col}")
