"""
services/forecast_service.py — Prophet-based forecasting for FinVision.

Responsibilities:
  1. Load financial data from uploaded CSV/XLSX files
  2. Auto-detect date and metric columns
  3. Aggregate to monthly frequency
  4. Run Prophet forecast with Best/Expected/Worst scenarios
  5. Calculate KPI summary cards
  6. Return chart-ready JSON for Recharts frontend
"""

import logging
import pandas as pd
import numpy as np
from prophet import Prophet
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


# ── Column Detection ──────────────────────────────────────────────────────────

DATE_KEYWORDS    = ["date", "month", "period", "time", "year", "ds"]
REVENUE_KEYWORDS = ["revenue", "sales", "income", "turnover", "receipts"]
EXPENSE_KEYWORDS = ["expense", "cost", "expenditure", "spending", "outflow", "payment"]
PROFIT_KEYWORDS  = ["profit", "net", "earning", "margin", "gain"]


def detect_date_column(df: pd.DataFrame) -> Optional[str]:
    """Find the most likely date column."""
    # First pass: check by keyword
    for column in df.columns:
        if any(k in column.lower() for k in DATE_KEYWORDS):
            try:
                converted = pd.to_datetime(df[column])
                if converted.notna().sum() > 0:
                    return column
            except Exception:
                continue
    # Second pass: try all columns
    for column in df.columns:
        try:
            converted = pd.to_datetime(df[column])
            if converted.notna().sum() > len(df) * 0.5:
                return column
        except Exception:
            continue
    return None


def detect_metric_column(df: pd.DataFrame, metric: str) -> Optional[str]:
    """Find the column matching the requested metric."""
    metric_lower = metric.lower()

    # Direct match first
    for col in df.columns:
        if col.lower() == metric_lower:
            return col

    # Keyword match
    keywords_map = {
        "revenue": REVENUE_KEYWORDS,
        "expense": EXPENSE_KEYWORDS,
        "profit":  PROFIT_KEYWORDS,
        "operational costs": EXPENSE_KEYWORDS,
        "net profit": PROFIT_KEYWORDS,
    }
    keywords = keywords_map.get(metric_lower, [metric_lower])

    for col in df.columns:
        col_lower = col.lower()
        if any(k in col_lower for k in keywords):
            if pd.api.types.is_numeric_dtype(df[date_col]):
                return col

    return None


def get_available_metrics(df: pd.DataFrame) -> list[str]:
    EXCLUDE = ["transaction_id", "id", "index", "row", "no", "number", "sr"]
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    return [c for c in numeric_cols if not any(ex in c.lower() for ex in EXCLUDE)]


# ── Data Loading ──────────────────────────────────────────────────────────────

def load_financial_data(
    file_path: str,
    file_type: str,
    sheet_name: Optional[str] = None,
    metric: str = "Revenue",
) -> tuple[pd.DataFrame, str, str]:
    """
    Load financial data from CSV or XLSX.
    Returns: (prepared_df, date_col, metric_col)
    prepared_df has columns: ds (date), y (metric value)
    """
    # Load file
    if file_type == "csv":
        df = pd.read_csv(file_path)
    elif file_type == "xlsx":
        if sheet_name:
            df = pd.read_excel(file_path, sheet_name=sheet_name)
        else:
            # Load first sheet by default
            xl = pd.ExcelFile(file_path)
            df = pd.read_excel(file_path, sheet_name=xl.sheet_names[0])
    else:
        raise ValueError(f"Unsupported file type: {file_type}")

    df = df.fillna(0)

    # Detect columns
    date_col   = detect_date_column(df)
    metric_col = detect_metric_column(df, metric)

    if not date_col:
        raise ValueError(
            f"No date column found. Make sure your file has a column with dates. "
            f"Found columns: {df.columns.tolist()}"
        )

    if not metric_col:
        available = get_available_metrics(df)
        raise ValueError(
            f"No column matching '{metric}' found. "
            f"Available numeric columns: {available}"
        )

    logger.info(f"Detected date column: '{date_col}', metric column: '{metric_col}'")

    # Prepare Prophet dataframe
    prophet_df = pd.DataFrame()
    prophet_df["ds"] = pd.to_datetime(df[date_col])
    prophet_df["y"]  = pd.to_numeric(df[metric_col], errors="coerce").fillna(0)

    # Remove rows with invalid dates
    prophet_df = prophet_df.dropna(subset=["ds"])
    prophet_df = prophet_df.sort_values("ds").reset_index(drop=True)

    prophet_df["ds"] = prophet_df["ds"].values.astype("datetime64[M]").astype("datetime64[ns]")
    prophet_df = (
    prophet_df.groupby("ds")["y"]
    .sum()
    .reset_index()
)

    logger.info(f"Data prepared: {len(prophet_df)} monthly records")
    return prophet_df, date_col, metric_col


def get_sheet_names(file_path: str, file_type: str) -> list[str]:
    """Return sheet names for XLSX files."""
    if file_type == "xlsx":
        xl = pd.ExcelFile(file_path)
        return xl.sheet_names
    return ["Sheet1"]


def get_file_metrics(file_path: str, file_type: str, sheet_name: Optional[str] = None) -> list[str]:
    """Return available numeric columns from the file."""
    if file_type == "csv":
        df = pd.read_csv(file_path)
    else:
        df = pd.read_excel(file_path, sheet_name=sheet_name or 0)
    return get_available_metrics(df)


# ── Prophet Forecasting ───────────────────────────────────────────────────────

def run_forecast(
    prophet_df: pd.DataFrame,
    periods:    int,
    freq:       str = "M",
) -> pd.DataFrame:
    """
    Run Prophet forecast.
    Returns dataframe with: ds, yhat, yhat_lower, yhat_upper
    """
    if len(prophet_df) < 2:
        raise ValueError("Need at least 2 data points to forecast.")

# Auto-disable yearly seasonality if less than 24 months of data
    has_2_years = len(prophet_df) >= 24

    model = Prophet(
        interval_width=0.95,
        yearly_seasonality=has_2_years,
        weekly_seasonality=False,
        daily_seasonality=False,
        seasonality_mode="additive",
)

    model.fit(prophet_df)

    future = model.make_future_dataframe(periods=periods, freq="MS")
    forecast = model.predict(future)

    # Ensure no negative values for revenue/expense metrics
    forecast["yhat"]       = forecast["yhat"].clip(lower=0)
    forecast["yhat_lower"] = forecast["yhat_lower"].clip(lower=0)
    forecast["yhat_upper"] = forecast["yhat_upper"].clip(lower=0)

    return forecast


# ── KPI Calculation ───────────────────────────────────────────────────────────

def calculate_kpis(
    historical: pd.DataFrame,
    forecast:   pd.DataFrame,
    metric:     str,
) -> dict:
    """
    Calculate KPI summary cards for the frontend dashboard.
    Returns values the Forecast tab KPI cards display.
    """
    hist_values = historical["y"].values
    future_only = forecast[forecast["ds"] > historical["ds"].max()]

    # Current period value (last historical)
    current_value = float(hist_values[-1]) if len(hist_values) > 0 else 0

    # Forecasted next period
    next_value = float(future_only["yhat"].iloc[0]) if len(future_only) > 0 else current_value

    # Year over year growth
    if len(hist_values) >= 12:
        yoy_growth = ((hist_values[-1] - hist_values[-12]) / abs(hist_values[-12])) * 100
    elif len(hist_values) >= 2:
        yoy_growth = ((hist_values[-1] - hist_values[0]) / abs(hist_values[0])) * 100
    else:
        yoy_growth = 0.0

    # Forecast period totals
    forecast_total    = float(future_only["yhat"].sum())
    forecast_best     = float(future_only["yhat_upper"].sum())
    forecast_worst    = float(future_only["yhat_lower"].sum())

    # Confidence score (based on interval width)
    avg_interval = float((future_only["yhat_upper"] - future_only["yhat_lower"]).mean())
    avg_value    = float(future_only["yhat"].mean())
    confidence   = max(0, min(100, 100 - (avg_interval / (avg_value + 1)) * 100)) if avg_value > 0 else 50

    return {
        "metric":          metric,
        "current_value":   round(current_value, 2),
        "next_period":     round(next_value, 2),
        "yoy_growth_pct":  round(yoy_growth, 2),
        "forecast_total":  round(forecast_total, 2),
        "forecast_best":   round(forecast_best, 2),
        "forecast_worst":  round(forecast_worst, 2),
        "confidence_pct":  round(confidence, 1),
        "data_points":     len(hist_values),
    }


# ── Chart Data Builder ────────────────────────────────────────────────────────

def build_chart_data(
    historical: pd.DataFrame,
    forecast:   pd.DataFrame,
) -> list[dict]:
    """
    Build Recharts-compatible JSON.
    Each point has: date, actual, expected, best, worst, is_forecast
    Frontend uses this directly to render the line chart.
    """
    chart_data = []
    hist_end   = historical["ds"].max()

    # Historical points (actual values)
    for _, row in historical.iterrows():
        chart_data.append({
            "date":        row["ds"].strftime("%Y-%m"),
            "actual":      round(float(row["y"]), 2),
            "expected":    None,
            "best":        None,
            "worst":       None,
            "is_forecast": False,
        })

    # Forecast points (predicted values)
    future_forecast = forecast[forecast["ds"] > hist_end]
    for _, row in future_forecast.iterrows():
        chart_data.append({
            "date":        row["ds"].strftime("%Y-%m"),
            "actual":      None,
            "expected":    round(float(row["yhat"]),       2),
            "best":        round(float(row["yhat_upper"]), 2),
            "worst":       round(float(row["yhat_lower"]), 2),
            "is_forecast": True,
        })

    return chart_data


# ── Main Entry Point ──────────────────────────────────────────────────────────

def generate_forecast(
    file_path:  str,
    file_type:  str,
    metric:     str,
    horizon:    str,            # "6M", "12M", "24M"
    sheet_name: Optional[str] = None,
) -> dict:
    """
    Full forecasting pipeline.
    Called by the forecast router.

    Returns complete response for the Forecast tab:
    {
        "chart_data": [...],    # Recharts data
        "kpis": {...},          # KPI cards
        "metric": str,
        "horizon": str,
        "periods": int,
        "sheet_name": str,
    }
    """
    # Parse horizon
    horizon_map = {"6M": 6, "12M": 12, "24M": 24}
    periods     = horizon_map.get(horizon.upper(), 12)

    logger.info(f"Generating forecast: metric={metric}, horizon={horizon}, sheet={sheet_name}")

    # Load and prepare data
    prophet_df, date_col, metric_col = load_financial_data(
        file_path, file_type, sheet_name, metric
    )

    if len(prophet_df) < 2:
        raise ValueError(
            "Not enough data points to forecast. "
            "Need at least 2 months of data."
        )

    # Run Prophet
    forecast = run_forecast(prophet_df, periods)

    # Build response
    chart_data = build_chart_data(prophet_df, forecast)
    kpis       = calculate_kpis(prophet_df, forecast, metric)

    logger.info(f"✅ Forecast complete: {len(chart_data)} chart points | confidence: {kpis['confidence_pct']}%")

    return {
        "chart_data":  chart_data,
        "kpis":        kpis,
        "metric":      metric,
        "metric_col":  metric_col,
        "date_col":    date_col,
        "horizon":     horizon,
        "periods":     periods,
        "sheet_name":  sheet_name or "default",
        "data_points": len(prophet_df),
    }
