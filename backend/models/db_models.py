"""
models/db_models.py — All SQLAlchemy table definitions for FinVision.

Tables:
  - users              → registered users with roles
  - uploaded_files     → file metadata per user
  - chat_sessions      → conversation groupings
  - chat_messages      → individual messages + citations
  - forecast_results   → saved forecast outputs
  - reports            → generated report records
  - system_settings    → supervisor-controlled RAG/LLM config
  - system_logs        → audit trail of all system events
  - backup_records     → database backup history
"""

from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Text,
    DateTime, ForeignKey, Enum, JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from database import Base


# ── Enums ─────────────────────────────────────────────────────────────────────

class UserRole(str, enum.Enum):
    analyst    = "analyst"
    supervisor = "supervisor"


class FileStatus(str, enum.Enum):
    processing = "processing"
    verified   = "verified"
    failed     = "failed"


class FileType(str, enum.Enum):
    csv   = "csv"
    xlsx  = "xlsx"
    pdf   = "pdf"


class LogLevel(str, enum.Enum):
    info    = "info"
    warn    = "warn"
    success = "success"
    error   = "error"


class BackupType(str, enum.Enum):
    full        = "full"
    incremental = "incremental"


class BackupStatus(str, enum.Enum):
    success = "success"
    running = "running"
    failed  = "failed"


# ── Users ─────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    name          = Column(String(120), nullable=False)
    email         = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role          = Column(Enum(UserRole), default=UserRole.analyst, nullable=False)
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    files         = relationship("UploadedFile", back_populates="owner")
    chat_sessions = relationship("ChatSession",  back_populates="user")
    reports       = relationship("Report",       back_populates="owner")


# ── Uploaded Files ────────────────────────────────────────────────────────────

class UploadedFile(Base):
    __tablename__ = "uploaded_files"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename      = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=False)
    file_type     = Column(Enum(FileType), nullable=False)
    file_size     = Column(Integer, nullable=False)         # bytes
    file_path     = Column(String(500), nullable=False)     # path on disk
    status        = Column(Enum(FileStatus), default=FileStatus.processing)
    chunk_count   = Column(Integer, default=0)              # chunks stored in ChromaDB
    is_active     = Column(Boolean, default=True)           # selected as AI context
    error_msg     = Column(Text, nullable=True)             # if status=failed
    uploaded_at   = Column(DateTime(timezone=True), server_default=func.now())
    indexed_at    = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    owner         = relationship("User",        back_populates="files")


# ── Chat Sessions ─────────────────────────────────────────────────────────────

class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    title      = Column(String(255), default="New Conversation")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user       = relationship("User",        back_populates="chat_sessions")
    messages   = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")


# ── Chat Messages ─────────────────────────────────────────────────────────────

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id         = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id"), nullable=False)
    role       = Column(String(20), nullable=False)   # "user" or "assistant"
    content    = Column(Text, nullable=False)
    citations  = Column(JSON, nullable=True)          # list of citation dicts
    latency_ms = Column(Integer, nullable=True)       # response time in ms
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    session    = relationship("ChatSession", back_populates="messages")


# ── Forecast Results ──────────────────────────────────────────────────────────

class ForecastResult(Base):
    __tablename__ = "forecast_results"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False)
    file_id      = Column(Integer, ForeignKey("uploaded_files.id"), nullable=True)
    metric       = Column(String(100), nullable=False)   # Revenue, Net Profit, etc.
    horizon      = Column(String(20),  nullable=False)   # 6M, 12M, 24M
    forecast_data= Column(JSON, nullable=False)          # full Prophet output
    kpis         = Column(JSON, nullable=True)           # summary KPI cards
    created_at   = Column(DateTime(timezone=True), server_default=func.now())


# ── Reports ───────────────────────────────────────────────────────────────────

class Report(Base):
    __tablename__ = "reports"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False)
    title        = Column(String(255), nullable=False)
    report_type  = Column(String(50),  nullable=False)   # financial, revenue, opex, etc.
    content      = Column(Text, nullable=True)           # generated narrative
    pdf_path     = Column(String(500), nullable=True)    # path to PDF file
    excel_path   = Column(String(500), nullable=True)    # path to Excel file
    page_count   = Column(Integer, default=0)
    file_size_kb = Column(Integer, default=0)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    owner        = relationship("User", back_populates="reports")


# ── System Settings (Supervisor-controlled) ───────────────────────────────────

class SystemSettings(Base):
    __tablename__ = "system_settings"

    id               = Column(Integer, primary_key=True, index=True)
    llm_model        = Column(String(100), default="mixtral-8x7b-32768")
    embedding_model  = Column(String(100), default="all-MiniLM-L6-v2")
    temperature      = Column(Float,   default=0.35)
    max_tokens       = Column(Integer, default=2048)
    chunk_size       = Column(Integer, default=512)
    chunk_overlap    = Column(Integer, default=50)
    k_value          = Column(Integer, default=6)
    top_p            = Column(Float,   default=0.90)
    freq_penalty     = Column(Float,   default=0.20)
    updated_at       = Column(DateTime(timezone=True), onupdate=func.now())
    updated_by       = Column(Integer, ForeignKey("users.id"), nullable=True)


# ── System Logs ───────────────────────────────────────────────────────────────

class SystemLog(Base):
    __tablename__ = "system_logs"

    id         = Column(Integer, primary_key=True, index=True)
    event      = Column(Text,        nullable=False)
    level      = Column(Enum(LogLevel), default=LogLevel.info)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_email = Column(String(255), nullable=True)   # stored directly for quick display
    extra_data   = Column(JSON, nullable=True)          # any extra context
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ── Backup Records ────────────────────────────────────────────────────────────

class BackupRecord(Base):
    __tablename__ = "backup_records"

    id          = Column(Integer, primary_key=True, index=True)
    label       = Column(String(100), nullable=False)
    backup_type = Column(Enum(BackupType), default=BackupType.full)
    status      = Column(Enum(BackupStatus), default=BackupStatus.running)
    file_path   = Column(String(500), nullable=True)
    size_bytes  = Column(Integer, default=0)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    completed_at= Column(DateTime(timezone=True), nullable=True)
    error_msg   = Column(Text, nullable=True)
