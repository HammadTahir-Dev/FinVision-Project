"""
routers/upload.py — File upload and management endpoints.

Endpoints:
  POST   /upload/file           → upload a CSV, XLSX, or PDF file
  GET    /upload/files          → list all files for current user
  PATCH  /upload/files/{id}/toggle → toggle file as active AI context
  DELETE /upload/files/{id}     → delete a file
  GET    /upload/files/{id}/status → check processing status
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import os
import re
import uuid
import logging

from database import get_db
from config import get_settings
from models.db_models import UploadedFile, FileStatus, FileType, User, SystemLog, LogLevel
from routers.auth import get_current_user, log_event
from services.billing_service import check_limit, record_usage, max_file_mb

logger   = logging.getLogger(__name__)
settings = get_settings()
router   = APIRouter(prefix="/upload", tags=["File Upload"])

ALLOWED_EXTENSIONS = {"csv": FileType.csv, "xlsx": FileType.xlsx, "pdf": FileType.pdf}
MAX_FILE_SIZE_MB   = 100        # hard server cap; each plan sets its own lower limit


# ── Response Schemas ──────────────────────────────────────────────────────────

class FileResponse(BaseModel):
    id:            int
    filename:      str
    original_name: str
    file_type:     str
    file_size:     int
    status:        str
    chunk_count:   int
    is_active:     bool
    uploaded_at:   Optional[datetime]
    indexed_at:    Optional[datetime]
    error_msg:     Optional[str]

    class Config:
        from_attributes = True


# ── Background Task: Ingest file into ChromaDB ────────────────────────────────

def ingest_file_to_chromadb(file_id: int, file_path: str, file_type: str, db_url: str):
    """
    Runs in the background after upload.
    Parses the file, chunks the text, embeds it, and stores in ChromaDB.
    Updates the file status in the database when done.

    """
    # Reuse the app's connection pool (creating a new engine per upload leaked
    # connections and ignored the driver fix in database.py).
    from database import SessionLocal
    db = SessionLocal()

    try:
        file_record = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
        if not file_record:
            return

        logger.info(f"Starting ingestion for file {file_id}: {file_path}")

        # ── Real ingestion via RAG service ───────────────────────────────────
        from services.rag_service import ingest_file

        chunk_count = ingest_file(
            file_id=file_id,
            file_path=file_path,
            file_type=file_type,
            user_id=file_record.user_id,
            filename=file_record.original_name,
        )

        file_record.status      = FileStatus.verified
        file_record.chunk_count = chunk_count
        file_record.indexed_at  = datetime.utcnow()
        db.commit()

        logger.info(f"✅ File {file_id} ingested: {chunk_count} chunks")

    except Exception as e:
        logger.error(f"❌ Ingestion failed for file {file_id}: {e}")
        try:
            file_record = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
            if file_record:
                file_record.status    = FileStatus.failed
                file_record.error_msg = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/file", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    background_tasks: BackgroundTasks,
    file:         UploadFile = File(...),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    """
    Upload a CSV, XLSX, or PDF file.
    File is saved to disk immediately and ingestion runs in the background.
    """
    # ── Validate name & extension ─────────────────────────────────────────────
    # basename() blocks path tricks like "../../main.py"; odd characters are replaced
    safe_name = os.path.basename((file.filename or "").replace("\\", "/")).strip()
    safe_name = re.sub(r"[^\w.\- ()]", "_", safe_name) or "upload"
    ext = safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '.{ext}' not supported. Use CSV, XLSX, or PDF.",
        )

    # ── Plan limit (monthly uploads) ──────────────────────────────────────────
    check_limit(db, current_user, "uploads")

    # ── Validate file size ────────────────────────────────────────────────────
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The file is empty.")
    size_mb  = len(contents) / (1024 * 1024)
    allowed_mb = max_file_mb(db, current_user, MAX_FILE_SIZE_MB)
    if size_mb > allowed_mb:
        detail = f"File exceeds {allowed_mb:g}MB limit."
        if allowed_mb < MAX_FILE_SIZE_MB:
            raise HTTPException(status_code=402, detail=f"{detail} Your plan allows files up to {allowed_mb:g}MB — upgrade for larger files.")
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=detail)

    # ── Save file to disk ─────────────────────────────────────────────────────
    user_upload_dir = os.path.join(settings.upload_dir, str(current_user.id))
    os.makedirs(user_upload_dir, exist_ok=True)

    unique_name = f"{uuid.uuid4().hex}_{safe_name}"
    file_path   = os.path.join(user_upload_dir, unique_name)

    with open(file_path, "wb") as f:
        f.write(contents)

    # ── Save metadata to DB ───────────────────────────────────────────────────
    file_record = UploadedFile(
        user_id       = current_user.id,
        filename      = unique_name,
        original_name = safe_name,
        file_type     = ALLOWED_EXTENSIONS[ext],
        file_size     = len(contents),
        file_path     = file_path,
        status        = FileStatus.processing,
        is_active     = True,
    )
    db.add(file_record)
    db.commit()
    db.refresh(file_record)
    record_usage(db, current_user, "uploads")

    log_event(
        db, f"File uploaded: {safe_name} ({size_mb:.1f} MB)",
        LogLevel.info, current_user,
        metadata={"file_id": file_record.id, "file_type": ext},
    )

    # ── Start background ingestion ────────────────────────────────────────────
    background_tasks.add_task(
        ingest_file_to_chromadb,
        file_record.id,
        file_path,
        ext,
        settings.database_url,
    )

    logger.info(f"📁 File saved: {file_path} | Background ingestion started")
    return file_record


@router.get("/files", response_model=list[FileResponse])
def list_files(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Returns all files uploaded by the current user, newest first."""
    files = (
        db.query(UploadedFile)
        .filter(UploadedFile.user_id == current_user.id)
        .order_by(UploadedFile.uploaded_at.desc())
        .all()
    )
    return files


@router.patch("/files/{file_id}/toggle", response_model=FileResponse)
def toggle_file_active(
    file_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Toggle a file's is_active flag.
    Active files are used as AI context in the chat.
    """
    file_record = db.query(UploadedFile).filter(
        UploadedFile.id      == file_id,
        UploadedFile.user_id == current_user.id,
    ).first()

    if not file_record:
        raise HTTPException(status_code=404, detail="File not found.")

    file_record.is_active = not file_record.is_active
    db.commit()
    db.refresh(file_record)
    return file_record


@router.delete("/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_file(
    file_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Deletes a file record from DB and removes it from disk.
    Also removes its chunks from ChromaDB (Phase 2).
    """
    file_record = db.query(UploadedFile).filter(
        UploadedFile.id      == file_id,
        UploadedFile.user_id == current_user.id,
    ).first()

    if not file_record:
        raise HTTPException(status_code=404, detail="File not found.")

    # Remove from disk (plus any preprocessing undo snapshots)
    try:
        if os.path.exists(file_record.file_path):
            os.remove(file_record.file_path)
        from services.preprocess_service import clear_history
        clear_history(file_record.file_path)
    except Exception as e:
        logger.warning(f"Could not delete file from disk: {e}")

    # Remove chunks from ChromaDB
    try:
        from services.rag_service import delete_file_chunks
        delete_file_chunks(file_id)
    except Exception as e:
        logger.warning(f"Could not delete ChromaDB chunks: {e}")

    log_event(
        db, f"File deleted: {file_record.original_name}",
        LogLevel.info, current_user,
        metadata={"file_id": file_id},
    )

    # Delete related forecast results first to avoid FK violation
    from models.db_models import ForecastResult
    db.query(ForecastResult).filter(ForecastResult.file_id == file_id).delete()

    db.delete(file_record)
    db.commit()


@router.get("/files/{file_id}/status", response_model=FileResponse)
def get_file_status(
    file_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Poll this endpoint to check if a file has finished processing."""
    file_record = db.query(UploadedFile).filter(
        UploadedFile.id      == file_id,
        UploadedFile.user_id == current_user.id,
    ).first()

    if not file_record:
        raise HTTPException(status_code=404, detail="File not found.")

    return file_record
