"""
main.py — FinVision Backend Entry Point

Run with:
    uvicorn main:app --reload --port 8000

API Docs available at:
    http://localhost:8000/docs       (Swagger UI)
    http://localhost:8000/redoc      (ReDoc)
"""

import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import get_settings
from database import create_all_tables, check_db_connection

# ── Import Routers ────────────────────────────────────────────────────────────
from routers.auth       import router as auth_router
from routers.upload     import router as upload_router
from routers.chat       import router as chat_router
from routers.forecast   import router as forecast_router
from routers.reports    import router as reports_router
from routers.supervisor import router as supervisor_router

# ── Logging Setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger   = logging.getLogger(__name__)
settings = get_settings()


# ── Startup / Shutdown ────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Runs on startup and shutdown."""
    logger.info("=" * 60)
    logger.info(f"🚀 Starting {settings.app_name} Backend")
    logger.info("=" * 60)

    # Create upload and chroma directories
    settings.ensure_dirs()
    logger.info(f"📁 Upload dir  : {settings.upload_dir}")
    logger.info(f"📁 ChromaDB dir: {settings.chroma_dir}")

    # Create database tables
    logger.info("🗄️  Initializing database tables...")
    create_all_tables()

    # Check DB connection
    db_status = check_db_connection()
    if db_status["status"] == "healthy":
        logger.info(f"✅ Database     : {db_status['detail']}")
    else:
        logger.error(f"❌ Database     : {db_status['detail']}")

    # Seed default system settings if not present
    seed_system_settings()

    # Preload embedding model so background re-indexing is fast
    try:
        from services.rag_service import get_embedder, get_chroma_collection
        get_embedder()
        get_chroma_collection()
        logger.info("✅ Embedding model preloaded")
    except Exception as e:
        logger.warning(f"Could not preload embedding model: {e}")

    logger.info("=" * 60)
    logger.info(f"📖 API Docs: http://localhost:8000/docs")
    logger.info("=" * 60)

    yield  # App runs here

    logger.info("🛑 FinVision Backend shutting down...")


def seed_system_settings():
    """Create the default SystemSettings row if it doesn't exist."""
    try:
        from database import SessionLocal
        from models.db_models import SystemSettings
        db = SessionLocal()
        existing = db.query(SystemSettings).first()
        if not existing:
            defaults = SystemSettings(
                llm_model       = settings.default_llm_model,
                embedding_model = settings.default_embedding_model,
                temperature     = settings.default_temperature,
                max_tokens      = settings.default_max_tokens,
                chunk_size      = settings.default_chunk_size,
                chunk_overlap   = settings.default_chunk_overlap,
                k_value         = settings.default_k_value,
            )
            db.add(defaults)
            db.commit()
            logger.info("⚙️  Default system settings seeded")
        else:
            logger.info(f"⚙️  System settings loaded (LLM: {existing.llm_model})")
        db.close()
    except Exception as e:
        logger.warning(f"Could not seed system settings: {e}")


# ── App Initialization ────────────────────────────────────────────────────────

app = FastAPI(
    title       = "FinVision API",
    description = "AI-powered financial analytics platform for SMEs",
    version     = "1.0.0",
    lifespan    = lifespan,
    docs_url    = "/docs",
    redoc_url   = "/redoc",
)


# ── CORS Middleware ───────────────────────────────────────────────────────────
# Allows your React frontend (localhost:5173) to call this backend

app.add_middleware(
    CORSMiddleware,
    allow_origins     = settings.get_origins_list(),
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)


# ── Request Timing Middleware ─────────────────────────────────────────────────

@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Adds X-Process-Time header to every response (useful for debugging)."""
    start    = time.time()
    response = await call_next(request)
    duration = (time.time() - start) * 1000  # ms
    response.headers["X-Process-Time-Ms"] = f"{duration:.1f}"
    return response


# ── Global Exception Handler ──────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error on {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Check backend logs."},
    )


# ── Register Routers ──────────────────────────────────────────────────────────

app.include_router(auth_router)
app.include_router(upload_router)
app.include_router(chat_router)
app.include_router(forecast_router)
app.include_router(reports_router)
app.include_router(supervisor_router)


# ── Core Endpoints ────────────────────────────────────────────────────────────

@app.get("/", tags=["Root"])
def root():
    return {
        "app":     settings.app_name,
        "version": "1.0.0",
        "status":  "running",
        "docs":    "/docs",
    }


@app.get("/health", tags=["Health"])
def health_check():
    """
    Health check endpoint.
    Checks: API status, DB connection, disk directories.
    The Supervisor dashboard uses this to display system health.
    """
    db_status = check_db_connection()

    import os
    upload_ok = os.path.isdir(settings.upload_dir)
    chroma_ok = os.path.isdir(settings.chroma_dir)

    all_healthy = (
        db_status["status"] == "healthy"
        and upload_ok
        and chroma_ok
    )

    return {
        "status":    "healthy" if all_healthy else "degraded",
        "timestamp": datetime.utcnow().isoformat(),
        "services": {
            "api":      {"status": "healthy"},
            "database": db_status,
            "storage": {
                "status": "healthy" if upload_ok else "unhealthy",
                "upload_dir": settings.upload_dir,
            },
            "chromadb": {
                "status": "healthy" if chroma_ok else "unhealthy",
                "chroma_dir": settings.chroma_dir,
            },
        },
    }
