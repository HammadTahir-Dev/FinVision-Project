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
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import logging

from database import get_db
from config import get_settings
from models.db_models import (
    User, UploadedFile, FileStatus,
    ChatSession, ChatMessage,
    SystemSettings, SystemLog, LogLevel,
)
from routers.auth import get_current_user, log_event
from services.rag_service import query_rag, preprocess_command

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


class SessionResponse(BaseModel):
    id:         int
    title:      str
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    message_count: int = 0

    class Config:
        from_attributes = True


class MessageResponse(BaseModel):
    id:         int
    role:       str
    content:    str
    citations:  Optional[list] = None
    latency_ms: Optional[int]  = None
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class PreprocessRequest(BaseModel):
    file_id: int
    command: str   # e.g. "remove all duplicate rows"


# ── Chat Sessions ─────────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """List all chat sessions for the current user, newest first."""
    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.created_at.desc())
        .all()
    )
    result = []
    for s in sessions:
        msg_count = db.query(ChatMessage).filter(ChatMessage.session_id == s.id).count()
        result.append(SessionResponse(
            id=s.id,
            title=s.title,
            created_at=s.created_at,
            updated_at=s.updated_at,
            message_count=msg_count,
        ))
    return result


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
    if payload.session_id:
        session = db.query(ChatSession).filter(
            ChatSession.id      == payload.session_id,
            ChatSession.user_id == current_user.id,
        ).first()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found.")
    else:
        # Auto-title the session from the first question (first 60 chars)
        title   = question[:60] + "..." if len(question) > 60 else question
        session = ChatSession(user_id=current_user.id, title=title)
        db.add(session)
        db.commit()
        db.refresh(session)

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
        )
    except Exception as e:
        logger.error(f"RAG query failed: {e}")
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
        latency_ms=result["latency_ms"],
    )
    db.add(assistant_msg)
    db.commit()
    db.refresh(assistant_msg)

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
        latency_ms=result["latency_ms"],
    )


# ── Preprocess Endpoint ───────────────────────────────────────────────────────

@router.post("/preprocess")
def preprocess(
    payload:      PreprocessRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Natural language preprocessing command on an uploaded file.
    Example commands:
      - "remove all duplicate rows"
      - "fill missing values with 0"
      - "normalize the revenue column"
    """
    # Validate file ownership
    file_record = db.query(UploadedFile).filter(
        UploadedFile.id      == payload.file_id,
        UploadedFile.user_id == current_user.id,
    ).first()

    if not file_record:
        raise HTTPException(status_code=404, detail="File not found.")

    if file_record.file_type.value not in ["csv", "xlsx"]:
        raise HTTPException(
            status_code=400,
            detail="Preprocessing only supports CSV and XLSX files.",
        )

    # Run preprocessing
    result = preprocess_command(
        command=payload.command,
        file_path=file_record.file_path,
        file_type=file_record.file_type.value,
    )

    if result.get("success"):
        log_event(
            db,
            f"Preprocessing: '{payload.command}' on {file_record.original_name}",
            LogLevel.info,
            current_user,
        )
        from services.rag_service import ingest_file, delete_file_chunks
        import threading

        file_id   = file_record.id
        file_path = file_record.file_path
        file_type = file_record.file_type.value
        user_id   = current_user.id
        filename  = file_record.original_name

        def re_ingest():
            try:
                delete_file_chunks(file_id)
                chunk_count = ingest_file(
                    file_id=file_id, file_path=file_path,
                    file_type=file_type, user_id=user_id, filename=filename,
                )
                from database import SessionLocal
                from models.db_models import UploadedFile, FileStatus as FS
                from datetime import datetime
                db2 = SessionLocal()
                f = db2.query(UploadedFile).filter(UploadedFile.id == file_id).first()
                if f:
                    f.status      = FS.verified
                    f.chunk_count = chunk_count
                    f.indexed_at  = datetime.utcnow()
                    db2.commit()
                db2.close()
            except Exception as e:
                import logging
                logging.getLogger(__name__).error(f"Re-ingest failed: {e}")

        file_record.status = FileStatus.processing
        db.commit()
        threading.Thread(target=re_ingest, daemon=True).start()

    return result
