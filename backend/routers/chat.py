"""
routers/chat.py — Chat and preprocessing endpoints for FinVision.

Endpoints:
  POST /chat/query          → RAG query with citations
  GET  /chat/sessions       → list chat sessions
  GET  /chat/sessions/{id}  → get messages in a session
  POST /chat/sessions       → create new session
  DELETE /chat/sessions/{id}→ delete session
  POST /chat/preprocess     → natural language preprocessing command
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import logging
import os
import threading

from database import get_db, SessionLocal
from config import get_settings
from models.db_models import (
    User, UploadedFile, FileStatus,
    ChatSession, ChatMessage,
    SystemSettings, SystemLog, LogLevel,
)
from routers.auth import get_current_user, log_event
from services.rag_service import query_rag, ingest_file, delete_file_chunks
from services.preprocess_service import run_preprocess, describe_file, undo_last
from services.billing_service import check_limit, record_usage

logger   = logging.getLogger(__name__)
settings = get_settings()
router   = APIRouter(prefix="/chat", tags=["Chat & RAG"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_system_settings(db: Session) -> dict:
    """Load live RAG/LLM settings from DB (set by supervisor)."""
    row = db.query(SystemSettings).first()
    if not row:
        return {}
    return {
        "llm_model":   row.llm_model,
        "temperature": row.temperature,
        "max_tokens":  row.max_tokens,
        "k_value":     row.k_value,
        "top_p":       row.top_p,
    }


# ── Schemas ───────────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question:        str
    session_id:      Optional[int] = None   # if None, creates new session
    active_file_ids: Optional[list[int]] = None  # if None, uses all verified files


class QueryResponse(BaseModel):
    session_id:  int
    message_id:  int
    answer:      str
    citations:   list[dict]
    latency_ms:  int
    chart:       Optional[dict] = None    # drawn under the answer when the user asks for a graph
    audience:    Optional[str]  = None    # plain | general | expert


class SessionResponse(BaseModel):
    id:            int
    title:         str
    created_at:    Optional[datetime]
    updated_at:    Optional[datetime] = None
    last_activity: Optional[datetime] = None
    message_count: int = 0
    preview:       Optional[str] = None     # first line of the latest message

    class Config:
        from_attributes = True


class MessageResponse(BaseModel):
    id:         int
    role:       str
    content:    str
    citations:  Optional[list] = None
    chart:      Optional[dict] = None
    latency_ms: Optional[int]  = None
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class SessionRename(BaseModel):
    title: str


class PreprocessRequest(BaseModel):
    file_id:    int
    command:    str                    # e.g. "remove all duplicate rows"
    sheet_name: Optional[str] = None   # XLSX only; defaults to the first sheet


# ── Chat Sessions ─────────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(
    q:            Optional[str] = None,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """List the user's chat sessions, most recently active first (optional title search)."""
    from sqlalchemy import func

    counts = (
        db.query(ChatMessage.session_id, func.count(ChatMessage.id).label("n"),
                 func.max(ChatMessage.id).label("last_id"))
        .join(ChatSession, ChatSession.id == ChatMessage.session_id)
        .filter(ChatSession.user_id == current_user.id)
        .group_by(ChatMessage.session_id)
        .subquery()
    )
    query = (
        db.query(ChatSession, counts.c.n, ChatMessage.content)
        .outerjoin(counts, counts.c.session_id == ChatSession.id)
        .outerjoin(ChatMessage, ChatMessage.id == counts.c.last_id)
        .filter(ChatSession.user_id == current_user.id)
    )
    if q and q.strip():
        query = query.filter(ChatSession.title.ilike(f"%{q.strip()}%"))
    rows = query.order_by(func.coalesce(ChatSession.updated_at, ChatSession.created_at).desc(),
                          ChatSession.id.desc()).all()
    out = []
    for sess, n, last in rows:
        preview = (last or "").strip().split("\n")[0][:120] or None
        out.append(SessionResponse(
            id=sess.id, title=sess.title, created_at=sess.created_at, updated_at=sess.updated_at,
            last_activity=sess.updated_at or sess.created_at, message_count=n or 0, preview=preview,
        ))
    return out


@router.post("/sessions", response_model=SessionResponse)
def create_session(
    title:        str     = "New Conversation",
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Create a new chat session."""
    session = ChatSession(user_id=current_user.id, title=title)
    db.add(session)
    db.commit()
    db.refresh(session)
    return SessionResponse(id=session.id, title=session.title, created_at=session.created_at)


@router.get("/sessions/{session_id}/messages", response_model=list[MessageResponse])
def get_messages(
    session_id:   int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Get all messages in a chat session."""
    session = db.query(ChatSession).filter(
        ChatSession.id      == session_id,
        ChatSession.user_id == current_user.id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    return messages


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
def rename_session(
    session_id:   int,
    payload:      SessionRename,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Rename a chat session."""
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty.")
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id, ChatSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    session.title = title[:255]
    db.commit()
    db.refresh(session)
    return SessionResponse(id=session.id, title=session.title, created_at=session.created_at,
                           updated_at=session.updated_at, last_activity=session.updated_at or session.created_at)


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id:   int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Delete a chat session and all its messages."""
    session = db.query(ChatSession).filter(
        ChatSession.id      == session_id,
        ChatSession.user_id == current_user.id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    db.delete(session)
    db.commit()
    return {"message": "Session deleted."}


# ── Main RAG Query Endpoint ───────────────────────────────────────────────────

@router.post("/query", response_model=QueryResponse)
def rag_query(
    payload:      QueryRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Core RAG endpoint — answers questions from uploaded financial documents.

    Flow:
      1. Validate question
      2. Resolve which files to search (active_file_ids or all verified)
      3. Get/create chat session
      4. Save user message
      5. Call RAG pipeline (ChromaDB retrieval + Groq LLM)
      6. Save assistant response with citations
      7. Return answer + citations
    """
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    if len(question) > 2000:
        raise HTTPException(status_code=400, detail="Question too long (max 2000 chars).")

    # ── Plan limit (monthly AI questions) ─────────────────────────────────────
    check_limit(db, current_user, "chat_queries")

    # ── Resolve active files ──────────────────────────────────────────────────
    if payload.active_file_ids:
        active_file_ids = payload.active_file_ids
    else:
        # Use all verified + active files for this user
        active_files = db.query(UploadedFile).filter(
            UploadedFile.user_id  == current_user.id,
            UploadedFile.status   == FileStatus.verified,
            UploadedFile.is_active == True,
        ).all()
        active_file_ids = [f.id for f in active_files]

    if not active_file_ids:
        raise HTTPException(
            status_code=400,
            detail="No active files found. Please upload and select files first.",
        )

    # ── Get or create chat session ────────────────────────────────────────────
    new_session = not payload.session_id
    if payload.session_id:
        session = db.query(ChatSession).filter(
            ChatSession.id      == payload.session_id,
            ChatSession.user_id == current_user.id,
        ).first()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found.")
    else:
        # Auto-title the session from the first question (first 60 chars)
        one_line = " ".join(question.split())
        title   = one_line[:60] + "..." if len(one_line) > 60 else one_line
        session = ChatSession(user_id=current_user.id, title=title)
        db.add(session)
        db.commit()
        db.refresh(session)

    # ── Earlier turns (so follow-up questions keep their context) ─────────────
    history = [
        {"role": m.role, "content": m.content, "chart": m.chart}
        for m in reversed(
            db.query(ChatMessage)
            .filter(ChatMessage.session_id == session.id)
            .order_by(ChatMessage.id.desc())
            .limit(12)
            .all()
        )
    ]

    # ── Save user message ─────────────────────────────────────────────────────
    user_msg = ChatMessage(
        session_id=session.id,
        role="user",
        content=question,
    )
    db.add(user_msg)
    db.commit()

    # ── Load live system settings ─────────────────────────────────────────────
    db_settings = get_system_settings(db)

    # ── Call RAG pipeline ─────────────────────────────────────────────────────
    try:
        result = query_rag(
            question=question,
            user_id=current_user.id,
            active_file_ids=active_file_ids,
            db_settings=db_settings,
            history=history,
        )
    except Exception as e:
        logger.error(f"RAG query failed: {e}")
        # Don't leave an unanswered question (or an empty new chat) in the history
        try:
            db.delete(user_msg)
            if new_session:
                db.delete(session)
            db.commit()
        except Exception:
            db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"AI query failed: {str(e)}. Check your Groq API key and try again.",
        )

    # ── Save assistant response ───────────────────────────────────────────────
    assistant_msg = ChatMessage(
        session_id=session.id,
        role="assistant",
        content=result["answer"],
        citations=result["citations"],
        chart=result.get("chart"),
        latency_ms=result["latency_ms"],
    )
    db.add(assistant_msg)
    session.updated_at = datetime.now(timezone.utc)   # keeps "most recent chat" ordering correct
    db.commit()
    db.refresh(assistant_msg)
    record_usage(db, current_user, "chat_queries")

    # ── Log the event ─────────────────────────────────────────────────────────
    log_event(
        db,
        f"RAG query answered in {result['latency_ms']}ms | {len(result['citations'])} citations",
        LogLevel.info,
        current_user,
        metadata={"session_id": session.id, "file_ids": active_file_ids},
    )

    return QueryResponse(
        session_id=session.id,
        message_id=assistant_msg.id,
        answer=result["answer"],
        citations=result["citations"],
        chart=result.get("chart"),
        audience=result.get("audience"),
        latency_ms=result["latency_ms"],
    )


# ── Preprocess Endpoints ──────────────────────────────────────────────────────

_reindex_locks: dict[int, threading.Lock] = {}


def _reindex_file(file_id: int, file_path: str, file_type: str, user_id: int, filename: str):
    """
    Re-embed a file after preprocessing so the chat sees the cleaned data.
    The file stays 'verified' the whole time (its data is already usable by
    pandas-based chat and forecasting), so it never disappears from the UI.
    One re-index per file at a time; each run indexes the latest content.
    """
    lock = _reindex_locks.setdefault(file_id, threading.Lock())
    with lock:
        db2 = SessionLocal()
        try:
            delete_file_chunks(file_id)
            chunk_count = ingest_file(
                file_id=file_id, file_path=file_path,
                file_type=file_type, user_id=user_id, filename=filename,
            )
            f = db2.query(UploadedFile).filter(UploadedFile.id == file_id).first()
            if f:
                f.status      = FileStatus.verified
                f.chunk_count = chunk_count
                f.indexed_at  = datetime.utcnow()
                f.error_msg   = None
                db2.commit()
        except Exception as e:
            logger.error(f"Re-index after preprocessing failed for file {file_id}: {e}")
            try:
                f = db2.query(UploadedFile).filter(UploadedFile.id == file_id).first()
                if f:
                    f.error_msg = f"Re-indexing failed: {e}"
                    db2.commit()
            except Exception:
                pass
        finally:
            db2.close()


def _get_tabular_file(db: Session, file_id: int, user: User) -> UploadedFile:
    file_record = db.query(UploadedFile).filter(
        UploadedFile.id      == file_id,
        UploadedFile.user_id == user.id,
    ).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found.")
    if file_record.file_type.value not in ("csv", "xlsx"):
        raise HTTPException(status_code=400, detail="Preprocessing only supports CSV and XLSX files.")
    if not os.path.exists(file_record.file_path):
        raise HTTPException(status_code=410, detail="The file is missing on the server. Please re-upload it.")
    return file_record


def _after_change(db: Session, file_record: UploadedFile, user: User):
    """Update size and start a background re-index."""
    file_record.file_size = os.path.getsize(file_record.file_path)
    db.commit()
    threading.Thread(
        target=_reindex_file,
        args=(file_record.id, file_record.file_path, file_record.file_type.value,
              user.id, file_record.original_name),
        daemon=True,
    ).start()


@router.post("/preprocess")
def preprocess(
    payload:      PreprocessRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Natural-language preprocessing on a CSV/XLSX file. Several steps can be
    chained: "remove duplicates and fill missing values with mean".
    Always returns HTTP 200 with {success: bool, ...} so the UI can show the reason.
    """
    file_record = _get_tabular_file(db, payload.file_id, current_user)

    result = run_preprocess(
        command     = payload.command,
        file_path   = file_record.file_path,
        file_type   = file_record.file_type.value,
        sheet       = payload.sheet_name,
        db_settings = get_system_settings(db),
    )

    if result.get("success") and result.get("changed"):
        log_event(
            db,
            f"Preprocessing: '{payload.command[:120]}' on {file_record.original_name}",
            LogLevel.info,
            current_user,
            metadata={"file_id": file_record.id, "operation": result.get("operation")},
        )
        _after_change(db, file_record, current_user)

    return result


@router.get("/preprocess/{file_id}/preview")
def preprocess_preview(
    file_id:      int,
    sheet_name:   Optional[str] = None,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Current first rows + data-quality profile (missing values, duplicates, types)."""
    file_record = _get_tabular_file(db, file_id, current_user)
    try:
        return describe_file(file_record.file_path, file_record.file_type.value, sheet_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read the file: {e}")


@router.post("/preprocess/{file_id}/undo")
def preprocess_undo(
    file_id:      int,
    sheet_name:   Optional[str] = None,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Revert the most recent preprocessing change."""
    file_record = _get_tabular_file(db, file_id, current_user)
    if not undo_last(file_record.file_path):
        raise HTTPException(status_code=400, detail="Nothing to undo for this file.")
    log_event(db, f"Preprocessing undone on {file_record.original_name}", LogLevel.info, current_user)
    _after_change(db, file_record, current_user)
    return {"success": True, **describe_file(file_record.file_path, file_record.file_type.value, sheet_name)}


@router.get("/preprocess/{file_id}/download")
def preprocess_download(
    file_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Download the current (cleaned) version of the file."""
    file_record = _get_tabular_file(db, file_id, current_user)
    stem, ext = os.path.splitext(file_record.original_name)
    media = "text/csv" if ext.lower() == ".csv" else \
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return FileResponse(file_record.file_path, media_type=media, filename=f"{stem}_cleaned{ext}")
