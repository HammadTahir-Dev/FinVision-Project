"""
routers/reports.py — Report generation and download endpoints.

Endpoints:
  POST   /reports/generate       → generate a new report
  GET    /reports                → list all reports for current user
  GET    /reports/{id}           → get report details
  GET    /reports/{id}/download/pdf   → download PDF
  GET    /reports/{id}/download/excel → download Excel
  DELETE /reports/{id}           → delete a report
"""

import os
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db
from config import get_settings
from models.db_models import (
    User, UploadedFile, FileStatus,
    Report, ForecastResult, SystemLog, LogLevel,
)
from routers.auth import get_current_user, log_event
from services.report_service import generate_report

logger   = logging.getLogger(__name__)
settings = get_settings()
router   = APIRouter(prefix="/reports", tags=["Reports"])

REPORTS_DIR = "./reports"


# ── Schemas ───────────────────────────────────────────────────────────────────

class ReportRequest(BaseModel):
    report_type:    str = "Financial Summary"   # Financial Summary, Revenue, OpEx, etc.
    company_name:   str = "My Company"
    period:         str = "2024-2025"
    file_ids:       Optional[list[int]] = None  # files to use for RAG context
    forecast_id:    Optional[int]       = None  # saved forecast to include


class ReportResponse(BaseModel):
    id:           int
    title:        str
    report_type:  str
    page_count:   int
    file_size_kb: int
    has_pdf:      bool
    has_excel:    bool
    created_at:   Optional[datetime]

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_system_settings(db: Session) -> dict:
    from models.db_models import SystemSettings
    row = db.query(SystemSettings).first()
    if not row:
        return {}
    return {
        "llm_model":   row.llm_model,
        "temperature": row.temperature,
        "max_tokens":  row.max_tokens,
    }


def build_rag_context(file_ids: list[int], user_id: int, question: str) -> Optional[str]:
    """Pull relevant context from ChromaDB for the report."""
    try:
        from services.rag_service import get_chroma_collection, get_embedder
        collection = get_chroma_collection()
        embedder   = get_embedder()

        query_embedding = embedder.encode([question], show_progress_bar=False).tolist()[0]

        where_filter = {
            "$and": [
                {"user_id": {"$eq": str(user_id)}},
                {"file_id": {"$in": [str(fid) for fid in file_ids]}},
            ]
        }

        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=min(8, collection.count() or 1),
            where=where_filter,
            include=["documents", "metadatas"],
        )

        docs  = results["documents"][0] if results["documents"] else []
        metas = results["metadatas"][0] if results["metadatas"] else []

        if not docs:
            return None

        context_parts = []
        for doc, meta in zip(docs, metas):
            source = meta.get("filename", "Unknown")
            context_parts.append(f"[From {source}]\n{doc}")

        return "\n\n---\n\n".join(context_parts)

    except Exception as e:
        logger.warning(f"Could not build RAG context: {e}")
        return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate", response_model=ReportResponse)
def create_report(
    payload:      ReportRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Generate a full financial report.
    Combines RAG context from uploaded files + forecast data into a
    professional PDF and Excel report.
    """
    # Resolve file IDs
    if payload.file_ids:
        file_ids = payload.file_ids
    else:
        # Use all active verified files
        active_files = db.query(UploadedFile).filter(
            UploadedFile.user_id   == current_user.id,
            UploadedFile.status    == FileStatus.verified,
            UploadedFile.is_active == True,
        ).all()
        file_ids = [f.id for f in active_files]

    # Build RAG context
    rag_context = None
    if file_ids:
        query = f"financial summary {payload.report_type} {payload.period} revenue expenses profit"
        rag_context = build_rag_context(file_ids, current_user.id, query)
        logger.info(f"RAG context built: {len(rag_context) if rag_context else 0} chars")

    # Load forecast data if provided
    forecast_data = None
    if payload.forecast_id:
        forecast_record = db.query(ForecastResult).filter(
            ForecastResult.id      == payload.forecast_id,
            ForecastResult.user_id == current_user.id,
        ).first()
        if forecast_record:
            forecast_data = {
                "chart_data": forecast_record.forecast_data,
                "kpis":       forecast_record.kpis,
            }

    # Get system settings
    db_settings = get_system_settings(db)

    # Generate report
    try:
        result = generate_report(
            user_id      = current_user.id,
            report_type  = payload.report_type,
            company_name = payload.company_name,
            period       = payload.period,
            rag_context  = rag_context,
            forecast_data= forecast_data,
            db_settings  = db_settings,
            output_dir   = REPORTS_DIR,
        )
    except Exception as e:
        logger.error(f"Report generation failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Report generation failed: {str(e)}"
        )

    # Save to DB
    report_record = Report(
        user_id      = current_user.id,
        title        = result["title"],
        report_type  = payload.report_type,
        content      = result["sections"].get("full_text", ""),
        pdf_path     = result["pdf_path"],
        excel_path   = result["excel_path"],
        page_count   = result["page_count"],
        file_size_kb = result["pdf_size_kb"],
    )
    db.add(report_record)
    db.commit()
    db.refresh(report_record)

    log_event(
        db,
        f"Report generated: {payload.report_type} | {payload.company_name}",
        LogLevel.success,
        current_user,
        metadata={"report_id": report_record.id},
    )

    return ReportResponse(
        id          = report_record.id,
        title       = report_record.title,
        report_type = report_record.report_type,
        page_count  = report_record.page_count,
        file_size_kb= report_record.file_size_kb,
        has_pdf     = report_record.pdf_path is not None,
        has_excel   = report_record.excel_path is not None,
        created_at  = report_record.created_at,
    )


@router.get("", response_model=list[ReportResponse])
def list_reports(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """List all reports for the current user, newest first."""
    reports = (
        db.query(Report)
        .filter(Report.user_id == current_user.id)
        .order_by(Report.created_at.desc())
        .all()
    )
    return [
        ReportResponse(
            id          = r.id,
            title       = r.title,
            report_type = r.report_type,
            page_count  = r.page_count,
            file_size_kb= r.file_size_kb,
            has_pdf     = r.pdf_path is not None,
            has_excel   = r.excel_path is not None,
            created_at  = r.created_at,
        )
        for r in reports
    ]


@router.get("/{report_id}/download/pdf")
def download_pdf(
    report_id:    int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Download the PDF version of a report."""
    report = db.query(Report).filter(
        Report.id      == report_id,
        Report.user_id == current_user.id,
    ).first()

    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    if not report.pdf_path or not os.path.exists(report.pdf_path):
        raise HTTPException(status_code=404, detail="PDF file not found.")

    return FileResponse(
        path=report.pdf_path,
        filename=f"{report.title}.pdf",
        media_type="application/pdf",
    )


@router.get("/{report_id}/download/excel")
def download_excel(
    report_id:    int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Download the Excel version of a report."""
    report = db.query(Report).filter(
        Report.id      == report_id,
        Report.user_id == current_user.id,
    ).first()

    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    if not report.excel_path or not os.path.exists(report.excel_path):
        raise HTTPException(status_code=404, detail="Excel file not found.")

    return FileResponse(
        path=report.excel_path,
        filename=f"{report.title}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.delete("/{report_id}")
def delete_report(
    report_id:    int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Delete a report and its files."""
    report = db.query(Report).filter(
        Report.id      == report_id,
        Report.user_id == current_user.id,
    ).first()

    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    # Delete files from disk
    for path in [report.pdf_path, report.excel_path]:
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except Exception as e:
                logger.warning(f"Could not delete file {path}: {e}")

    db.delete(report)
    db.commit()
    return {"message": "Report deleted."}
