"""
routers/forecast.py — Forecasting endpoints for FinVision.

Endpoints:
  POST /forecast/generate        → run Prophet forecast on a file
  GET  /forecast/file/{id}/meta  → get sheets and available metrics for a file
  GET  /forecast/results         → list saved forecast results
  GET  /forecast/results/{id}    → get a specific saved forecast
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
    ForecastResult, SystemLog, LogLevel,
)
from routers.auth import get_current_user, log_event
from services.forecast_service import generate_forecast, get_sheet_names, get_file_metrics

logger   = logging.getLogger(__name__)
settings = get_settings()
router   = APIRouter(prefix="/forecast", tags=["Forecasting"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ForecastRequest(BaseModel):
    file_id:    int
    metric:     str               # e.g. "Revenue", "Expense", "Profit"
    horizon:    str = "12M"       # "6M", "12M", "24M"
    sheet_name: Optional[str] = None


class ForecastResponse(BaseModel):
    id:          int
    metric:      str
    horizon:     str
    chart_data:  list
    kpis:        dict
    sheet_name:  str
    data_points: int
    created_at:  Optional[datetime]

    class Config:
        from_attributes = True


class FileMetaResponse(BaseModel):
    file_id:      int
    filename:     str
    file_type:    str
    sheets:       list[str]
    metrics:      list[str]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/file/{file_id}/meta", response_model=FileMetaResponse)
def get_file_meta(
    file_id:      int,
    sheet_name:   Optional[str] = None,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Returns available sheets and numeric metric columns for a file.
    Frontend calls this when user selects a file to populate
    the metric dropdown and sheet selector.
    """
    file_record = db.query(UploadedFile).filter(
        UploadedFile.id      == file_id,
        UploadedFile.user_id == current_user.id,
        UploadedFile.status  == FileStatus.verified,
    ).first()

    if not file_record:
        raise HTTPException(
            status_code=404,
            detail="File not found or not yet processed."
        )

    file_type = file_record.file_type.value

    # Get sheet names (XLSX only)
    try:
        sheets = get_sheet_names(file_record.file_path, file_type)
    except Exception as e:
        sheets = ["Sheet1"]
        logger.warning(f"Could not get sheet names: {e}")

    # Get available numeric columns
    try:
        metrics = get_file_metrics(
            file_record.file_path,
            file_type,
            sheet_name or (sheets[0] if sheets else None),
        )
    except Exception as e:
        metrics = []
        logger.warning(f"Could not get metrics: {e}")

    return FileMetaResponse(
        file_id   = file_id,
        filename  = file_record.original_name,
        file_type = file_type,
        sheets    = sheets,
        metrics   = metrics,
    )


@router.post("/generate", response_model=ForecastResponse)
def run_forecast(
    payload:      ForecastRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Generate a Prophet forecast for a selected metric.

    The frontend sends:
    - file_id: which uploaded file to use
    - metric: column name to forecast (Revenue, Expense, etc.)
    - horizon: how far ahead (6M, 12M, 24M)
    - sheet_name: which Excel sheet (optional)

    Returns chart data + KPI cards ready for Recharts.
    """
    # Validate file
    file_record = db.query(UploadedFile).filter(
        UploadedFile.id      == payload.file_id,
        UploadedFile.user_id == current_user.id,
        UploadedFile.status  == FileStatus.verified,
    ).first()

    if not file_record:
        raise HTTPException(
            status_code=404,
            detail="File not found or not yet indexed. Please upload and wait for processing."
        )

    # Validate horizon
    if payload.horizon.upper() not in ["6M", "12M", "24M"]:
        raise HTTPException(
            status_code=400,
            detail="Invalid horizon. Use '6M', '12M', or '24M'."
        )

    # Run forecast
    try:
        result = generate_forecast(
            file_path  = file_record.file_path,
            file_type  = file_record.file_type.value,
            metric     = payload.metric,
            horizon    = payload.horizon,
            sheet_name = payload.sheet_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Forecast failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Forecast generation failed: {str(e)}"
        )

    # Save result to DB
    forecast_record = ForecastResult(
        user_id       = current_user.id,
        file_id       = payload.file_id,
        metric        = payload.metric,
        horizon       = payload.horizon,
        forecast_data = result["chart_data"],
        kpis          = result["kpis"],
    )
    db.add(forecast_record)
    db.commit()
    db.refresh(forecast_record)

    log_event(
        db,
        f"Forecast generated: {payload.metric} | {payload.horizon} | {result['data_points']} data points",
        LogLevel.success,
        current_user,
        metadata={
            "file_id":    payload.file_id,
            "metric":     payload.metric,
            "confidence": result["kpis"]["confidence_pct"],
        },
    )

    return ForecastResponse(
        id          = forecast_record.id,
        metric      = result["metric"],
        horizon     = result["horizon"],
        chart_data  = result["chart_data"],
        kpis        = result["kpis"],
        sheet_name  = result["sheet_name"],
        data_points = result["data_points"],
        created_at  = forecast_record.created_at,
    )


@router.get("/results", response_model=list[dict])
def list_forecasts(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """List all saved forecast results for the current user."""
    results = (
        db.query(ForecastResult)
        .filter(ForecastResult.user_id == current_user.id)
        .order_by(ForecastResult.created_at.desc())
        .all()
    )
    return [
        {
            "id":         r.id,
            "metric":     r.metric,
            "horizon":    r.horizon,
            "kpis":       r.kpis,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in results
    ]


@router.get("/results/{result_id}", response_model=ForecastResponse)
def get_forecast(
    result_id:    int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Get a specific saved forecast result including full chart data."""
    result = db.query(ForecastResult).filter(
        ForecastResult.id      == result_id,
        ForecastResult.user_id == current_user.id,
    ).first()

    if not result:
        raise HTTPException(status_code=404, detail="Forecast result not found.")

    return ForecastResponse(
        id          = result.id,
        metric      = result.metric,
        horizon     = result.horizon,
        chart_data  = result.forecast_data,
        kpis        = result.kpis,
        sheet_name  = "saved",
        data_points = len(result.forecast_data),
        created_at  = result.created_at,
    )
