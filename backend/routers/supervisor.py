"""
routers/supervisor.py — Supervisor Dashboard endpoints for FinVision.
"""
import os
import subprocess
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from database import get_db, check_db_connection
from config import get_settings
from models.db_models import (
    User, UploadedFile, ChatMessage, ChatSession,
    ForecastResult, Report, SystemSettings,
    SystemLog, LogLevel, BackupRecord, BackupStatus, BackupType,
)
from routers.auth import get_current_user, require_supervisor, log_event

logger   = logging.getLogger(__name__)
settings = get_settings()
router   = APIRouter(prefix="/supervisor", tags=["Supervisor"])

BACKUP_DIR = "./backups"

AVAILABLE_MODELS = [
    {"id": "llama-3.1-8b-instant",            "name": "LLaMA 3.1 8B Instant",       "context": 128000, "speed": "fastest"},
    {"id": "llama-3.1-70b-versatile",         "name": "LLaMA 3.1 70B Versatile",    "context": 128000, "speed": "fast"},
    {"id": "llama-3.3-70b-versatile",         "name": "LLaMA 3.3 70B Versatile",    "context": 128000, "speed": "fast"},
    {"id": "llama3-groq-70b-8192-tool-use-preview", "name": "LLaMA 3 70B Tool Use", "context": 8192,   "speed": "medium"},
    {"id": "gemma2-9b-it",                    "name": "Gemma 2 9B",                  "context": 8192,   "speed": "fast"},
    {"id": "mixtral-8x7b-32768",              "name": "Mixtral 8x7B (deprecated)",   "context": 32768,  "speed": "medium"},
]

# ── Schemas ───────────────────────────────────────────────────────────────────
class SettingsUpdate(BaseModel):
    llm_model:       Optional[str]   = None
    embedding_model: Optional[str]   = None
    temperature:     Optional[float] = None
    max_tokens:      Optional[int]   = None
    chunk_size:      Optional[int]   = None
    chunk_overlap:   Optional[int]   = None
    k_value:         Optional[int]   = None
    top_p:           Optional[float] = None
    freq_penalty:    Optional[float] = None

class SandboxRequest(BaseModel):
    question:    str
    temperature: Optional[float] = None
    max_tokens:  Optional[int]   = None
    k_value:     Optional[int]   = None
    llm_model:   Optional[str]   = None

# ── Settings ──────────────────────────────────────────────────────────────────
@router.get("/settings")
def get_settings_endpoint(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    row = db.query(SystemSettings).first()
    if not row:
        raise HTTPException(status_code=404, detail="System settings not found.")
    return {
        "id":              row.id,
        "llm_model":       row.llm_model,
        "embedding_model": row.embedding_model,
        "temperature":     row.temperature,
        "max_tokens":      row.max_tokens,
        "chunk_size":      row.chunk_size,
        "chunk_overlap":   row.chunk_overlap,
        "k_value":         row.k_value,
        "top_p":           row.top_p,
        "freq_penalty":    row.freq_penalty,
        "updated_at":      row.updated_at.isoformat() if row.updated_at else None,
        "updated_by":      row.updated_by,
    }

@router.put("/settings")
def update_settings(
    payload:      SettingsUpdate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    row = db.query(SystemSettings).first()
    if not row:
        raise HTTPException(status_code=404, detail="System settings not found.")

    changes = []
    if payload.llm_model is not None:
        valid = [m["id"] for m in AVAILABLE_MODELS]
        if payload.llm_model not in valid:
            raise HTTPException(status_code=400, detail="Invalid model ID.")
        changes.append("llm_model: " + row.llm_model + " → " + payload.llm_model)
        row.llm_model = payload.llm_model
    if payload.embedding_model is not None:
        row.embedding_model = payload.embedding_model
    if payload.temperature is not None:
        if not 0.0 <= payload.temperature <= 2.0:
            raise HTTPException(status_code=400, detail="Temperature must be 0.0–2.0")
        changes.append("temperature → " + str(payload.temperature))
        row.temperature = payload.temperature
    if payload.max_tokens is not None:
        if not 100 <= payload.max_tokens <= 8000:
            raise HTTPException(status_code=400, detail="Max tokens must be 100–8000")
        row.max_tokens = payload.max_tokens
    if payload.chunk_size is not None:
        if not 100 <= payload.chunk_size <= 2000:
            raise HTTPException(status_code=400, detail="Chunk size must be 100–2000")
        row.chunk_size = payload.chunk_size
    if payload.chunk_overlap is not None:
        row.chunk_overlap = payload.chunk_overlap
    if payload.k_value is not None:
        if not 1 <= payload.k_value <= 20:
            raise HTTPException(status_code=400, detail="K value must be 1–20")
        changes.append("k_value → " + str(payload.k_value))
        row.k_value = payload.k_value
    if payload.top_p is not None:
        row.top_p = payload.top_p
    if payload.freq_penalty is not None:
        row.freq_penalty = payload.freq_penalty

    row.updated_by = current_user.id
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)

    log_event(
        db,
        "Settings updated: " + ("; ".join(changes) if changes else "parameters updated"),
        LogLevel.info, current_user,
    )
    return {
        "id":              row.id,
        "llm_model":       row.llm_model,
        "embedding_model": row.embedding_model,
        "temperature":     row.temperature,
        "max_tokens":      row.max_tokens,
        "chunk_size":      row.chunk_size,
        "chunk_overlap":   row.chunk_overlap,
        "k_value":         row.k_value,
        "top_p":           row.top_p,
        "freq_penalty":    row.freq_penalty,
        "updated_at":      row.updated_at.isoformat() if row.updated_at else None,
        "updated_by":      row.updated_by,
    }

@router.get("/settings/models")
def list_models(current_user: User = Depends(get_current_user)):
    return {"models": AVAILABLE_MODELS}

# ── Monitor ───────────────────────────────────────────────────────────────────
@router.get("/monitor")
def system_monitor(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    db_status = check_db_connection()

    def dir_size_mb(path):
        total = 0
        if os.path.exists(path):
            for dirpath, _, files in os.walk(path):
                for f in files:
                    try:
                        total += os.path.getsize(os.path.join(dirpath, f))
                    except Exception:
                        pass
        return round(total / (1024 * 1024), 2)

    total_users     = db.query(func.count(User.id)).scalar() or 0
    total_files     = db.query(func.count(UploadedFile.id)).scalar() or 0
    total_messages  = db.query(func.count(ChatMessage.id)).scalar() or 0
    total_sessions  = db.query(func.count(ChatSession.id)).scalar() or 0
    total_forecasts = db.query(func.count(ForecastResult.id)).scalar() or 0
    total_reports   = db.query(func.count(Report.id)).scalar() or 0
    active_files    = db.query(func.count(UploadedFile.id)).filter(UploadedFile.is_active == True).scalar() or 0
    active_users    = db.query(func.count(User.id)).filter(User.is_active == True).scalar() or 0

    latencies = [
        m.latency_ms for m in
        db.query(ChatMessage.latency_ms)
        .filter(ChatMessage.latency_ms.isnot(None), ChatMessage.role == "assistant")
        .order_by(ChatMessage.created_at.desc()).limit(100).all()
        if m.latency_ms
    ]
    avg_latency = round(sum(latencies) / len(latencies), 0) if latencies else 0

    sys_row = db.query(SystemSettings).first()

    return {
        "status":    "healthy" if db_status.get("status") == "healthy" else "degraded",
        "timestamp": datetime.utcnow().isoformat(),
        "database": {
            **db_status,
            "tables": {
                "users":     total_users,
                "active_users": active_users,
                "files":     total_files,
                "active_files": active_files,
                "messages":  total_messages,
                "sessions":  total_sessions,
                "forecasts": total_forecasts,
                "reports":   total_reports,
            }
        },
        "storage": {
            "upload_dir":     settings.upload_dir,
            "upload_size_mb": dir_size_mb(settings.upload_dir),
            "chroma_dir":     settings.chroma_dir,
            "chroma_size_mb": dir_size_mb(settings.chroma_dir),
        },
        "performance": {
            "avg_query_latency_ms": avg_latency,
            "total_queries":        total_messages // 2,
        },
        "current_settings": {
            "model":       sys_row.llm_model    if sys_row else "unknown",
            "k_value":     sys_row.k_value      if sys_row else 0,
            "temperature": sys_row.temperature  if sys_row else 0,
            "chunk_size":  sys_row.chunk_size   if sys_row else 0,
        }
    }

# ── Metrics ───────────────────────────────────────────────────────────────────
@router.get("/metrics")
def get_metrics(
    days:         int     = Query(7, ge=1, le=90),
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    since = datetime.utcnow() - timedelta(days=days)
    messages = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.created_at  >= since,
            ChatMessage.role        == "assistant",
            ChatMessage.latency_ms.isnot(None),
        )
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    latency_chart = [
        {"time": m.created_at.strftime("%m-%d %H:%M"), "latency_ms": m.latency_ms}
        for m in messages
    ]

    daily = {}
    for m in messages:
        day = m.created_at.strftime("%Y-%m-%d")
        daily[day] = daily.get(day, 0) + 1

    lats = [m.latency_ms for m in messages]
    return {
        "latency_chart": latency_chart,
        "daily_chart":   [{"date": d, "queries": c} for d, c in sorted(daily.items())],
        "summary": {
            "total_queries":  len(messages),
            "avg_latency_ms": round(sum(lats)/len(lats), 0) if lats else 0,
            "min_latency_ms": min(lats, default=0),
            "max_latency_ms": max(lats, default=0),
        }
    }

# ── Logs ──────────────────────────────────────────────────────────────────────
@router.get("/logs")
def get_logs(
    limit:        int           = Query(50, ge=1, le=500),
    level:        Optional[str] = None,
    db:           Session       = Depends(get_db),
    current_user: User          = Depends(get_current_user),
):
    q = db.query(SystemLog).order_by(SystemLog.created_at.desc())
    if level and level != "all":
        try:
            q = q.filter(SystemLog.level == LogLevel(level))
        except ValueError:
            pass
    logs = q.limit(limit).all()
    return [
        {
            "id":         log.id,
            "event":      log.event,
            "level":      log.level.value,
            "user_email": log.user_email or "system",
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]

# ── Backup ────────────────────────────────────────────────────────────────────
@router.post("/backup")
def trigger_backup(
    backup_type:  str     = Query("full"),
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts   = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(BACKUP_DIR, "finvision_backup_" + backup_type + "_" + ts + ".sql")

    record = BackupRecord(
        label       = "Manual " + backup_type + " backup — " + ts,
        backup_type = BackupType.full if backup_type == "full" else BackupType.incremental,
        status      = BackupStatus.running,
        file_path   = path,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    try:
        from urllib.parse import urlparse
        parsed = urlparse(settings.database_url)
        env    = os.environ.copy()
        env["PGPASSWORD"] = parsed.password or ""

        result = subprocess.run(
            ["pg_dump", "-h", parsed.hostname, "-p", str(parsed.port or 5432),
             "-U", parsed.username, "-F", "p", "-f", path, parsed.path.lstrip("/")],
            capture_output=True, text=True, env=env, timeout=120,
        )

        if result.returncode == 0:
            size = os.path.getsize(path)
            record.status       = BackupStatus.success
            record.size_bytes   = size
            record.completed_at = datetime.utcnow()
            db.commit()
            log_event(db, "Backup completed: " + path + " (" + str(size//1024) + " KB)", LogLevel.success, current_user)
            return {"status": "success", "backup_id": record.id, "file": path, "size_kb": size//1024}
        else:
            raise Exception(result.stderr or "pg_dump failed")

    except Exception as e:
        record.status       = BackupStatus.failed
        record.error_msg    = str(e)
        record.completed_at = datetime.utcnow()
        db.commit()
        log_event(db, "Backup failed: " + str(e), LogLevel.error, current_user)
        raise HTTPException(status_code=500, detail="Backup failed: " + str(e))

@router.get("/backup/history")
def backup_history(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    records = db.query(BackupRecord).order_by(BackupRecord.created_at.desc()).limit(20).all()
    return [
        {
            "id":           r.id,
            "label":        r.label,
            "backup_type":  r.backup_type.value,
            "status":       r.status.value,
            "size_kb":      r.size_bytes // 1024 if r.size_bytes else 0,
            "created_at":   r.created_at.isoformat() if r.created_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            "error_msg":    r.error_msg,
        }
        for r in records
    ]

# ── Sandbox ───────────────────────────────────────────────────────────────────
@router.post("/sandbox")
def sandbox_query(
    payload:      SandboxRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    from services.rag_service import query_rag

    active_files = db.query(UploadedFile).filter(
        UploadedFile.user_id   == current_user.id,
        UploadedFile.is_active == True,
    ).all()

    active_ids = [f.id for f in active_files]

    if not active_ids:
        return {
            "answer":     "No active verified files found. Upload and activate files first.",
            "citations":  [],
            "latency_ms": 0,
        }

    sys_row = db.query(SystemSettings).first()
    db_settings = {
        "llm_model":   payload.llm_model   or (sys_row.llm_model   if sys_row else settings.default_llm_model),
        "temperature": payload.temperature or (sys_row.temperature if sys_row else 0.35),
        "max_tokens":  payload.max_tokens  or (sys_row.max_tokens  if sys_row else 2048),
        "k_value":     payload.k_value     or (sys_row.k_value     if sys_row else 6),
        "top_p":       sys_row.top_p if sys_row else 0.9,
        "freq_penalty":sys_row.freq_penalty if sys_row else 0.2,
    }

    try:
        result = query_rag(
            question=payload.question,
            user_id=current_user.id,
            active_file_ids=active_ids,
            db_settings=db_settings,
        )
        result["params_used"] = db_settings
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Users ─────────────────────────────────────────────────────────────────────
@router.get("/users")
def list_users(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [
        {
            "id":           u.id,
            "name":         u.name,
            "email":        u.email,
            "role":         u.role.value,
            "is_active":    u.is_active,
            "created_at":   u.created_at.isoformat() if u.created_at else None,
            "file_count":   db.query(func.count(UploadedFile.id)).filter(UploadedFile.user_id == u.id).scalar() or 0,
            "message_count":db.query(func.count(ChatMessage.id)).filter(ChatMessage.session.has(user_id=u.id)).scalar() or 0,
        }
        for u in users
    ]

@router.patch("/users/{user_id}/toggle")
def toggle_user(
    user_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account.")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.is_active = not user.is_active
    db.commit()
    action = "activated" if user.is_active else "deactivated"
    log_event(db, "User " + action + ": " + user.email, LogLevel.info, current_user)
    return {"id": user.id, "email": user.email, "is_active": user.is_active, "action": action}