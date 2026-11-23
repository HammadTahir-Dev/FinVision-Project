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
import re
import pandas as pd
from services.file_utils import read_csv_any
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


def _looks_like_years(series: pd.Series) -> bool:
    s = pd.to_numeric(series, errors="coerce").dropna()
    return len(s) > 0 and bool(((s >= 1900) & (s <= 2100) & (s == s.round())).all())


def _to_dates(series: pd.Series) -> pd.Series:
    """Parse a column to datetimes without turning plain numbers into 1970 timestamps."""
    if pd.api.types.is_datetime64_any_dtype(series):
        return series
    if pd.api.types.is_numeric_dtype(series):
        if _looks_like_years(series):
            return pd.to_datetime(series.astype("Int64").astype("string"), format="%Y", errors="coerce")
        return pd.Series(pd.NaT, index=series.index)
    text = series.astype("string").str.strip()
    try:
        return pd.to_datetime(text, errors="coerce", format="mixed")
    except (TypeError, ValueError):
        return pd.to_datetime(text, errors="coerce")


def detect_date_column(df: pd.DataFrame) -> Optional[str]:
    """Find the most likely date column (numbers are never treated as dates, except year columns)."""
    best, best_ratio = None, 0.0
    for column in df.columns:
        name = str(column).lower()
        keyword = any(k in name for k in DATE_KEYWORDS)
        if pd.api.types.is_numeric_dtype(df[column]) and not (keyword and _looks_like_years(df[column])):
            continue
        parsed = _to_dates(df[column])
        ratio = parsed.notna().mean() if len(df) else 0
        if keyword and ratio > 0.5:
            return column
        if ratio > 0.8 and ratio > best_ratio:
            best, best_ratio = column, ratio
    return best


def detect_metric_column(df: pd.DataFrame, metric: str) -> Optional[str]:
    """Find the column matching the requested metric."""
    metric_lower = metric.lower().strip()

    # Direct match first (case-insensitive)
    for col in df.columns:
        if str(col).lower().strip() == metric_lower:
            return col

    # Keyword match
    keywords_map = {
        "revenue": REVENUE_KEYWORDS, "sales": REVENUE_KEYWORDS, "income": REVENUE_KEYWORDS,
        "expense": EXPENSE_KEYWORDS, "expenses": EXPENSE_KEYWORDS, "cost": EXPENSE_KEYWORDS,
        "operational costs": EXPENSE_KEYWORDS,
        "profit": PROFIT_KEYWORDS, "net profit": PROFIT_KEYWORDS,
    }
    keywords = keywords_map.get(metric_lower, [metric_lower])

    for col in df.columns:
        col_lower = str(col).lower()
        if any(k in col_lower for k in keywords):
            if pd.api.types.is_numeric_dtype(df[col]):   # was df[date_col] → NameError
                return col

    return None


_EXCLUDE_TOKENS = {"id", "index", "row", "no", "number", "sr", "serial", "code", "zip", "phone", "year", "month", "day"}


def get_available_metrics(df: pd.DataFrame) -> list[str]:
    """Numeric columns worth forecasting. Matches whole words, so 'Paid Amount',
    'Growth' or 'Economic Index' are no longer hidden by 'id'/'row'/'no'."""
    out = []
    for c in df.select_dtypes(include=[np.number]).columns:
        tokens = set(re.findall(r"[a-z]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", str(c)).lower()))
        if tokens & _EXCLUDE_TOKENS or str(c).lower().endswith("_id"):
            continue
        if df[c].notna().sum() == 0:
            continue
        out.append(str(c))
    return out


# ── Data Loading ──────────────────────────────────────────────────────────────

def _read_frame(file_path: str, file_type: str, sheet_name: Optional[str] = None) -> pd.DataFrame:
    if file_type == "csv":
        df = read_csv_any(file_path)
    elif file_type == "xlsx":
        xl = pd.ExcelFile(file_path)
        if sheet_name and sheet_name not in xl.sheet_names:
            raise ValueError(f"Sheet '{sheet_name}' not found. Sheets: {xl.sheet_names}")
        df = pd.read_excel(file_path, sheet_name=sheet_name or xl.sheet_names[0])
    else:
        raise ValueError(f"Unsupported file type: {file_type}")
    df.columns = [str(c) for c in df.columns]
    return df


def load_financial_data(
    file_path: str,
    file_type: str,
    sheet_name: Optional[str] = None,
    metric: str = "Revenue",
) -> tuple[pd.DataFrame, str, str]:
    """
    Load financial data from CSV or XLSX.
    Returns: (prepared_df, date_col, metric_col)
    prepared_df has columns: ds (month start), y (metric value)
    """
    df = _read_frame(file_path, file_type, sheet_name)
    # NOTE: no df.fillna(0) here — that turned missing dates into 1970-01-01 and
    # missing values into fake zero months, which dragged forecasts down.

    date_col   = detect_date_column(df)
    metric_col = detect_metric_column(df, metric)

    if not date_col:
        raise ValueError(
            "No date column found. Make sure your file has a column with dates "
            f"(e.g. 'Date' or 'Month'). Found columns: {df.columns.tolist()}"
        )
    if not metric_col:
        raise ValueError(
            f"No column matching '{metric}' found. "
            f"Available numeric columns: {get_available_metrics(df)}"
        )

    logger.info(f"Detected date column: '{date_col}', metric column: '{metric_col}'")

    prophet_df = pd.DataFrame({
        "ds": _to_dates(df[date_col]),
        "y":  pd.to_numeric(df[metric_col], errors="coerce"),
    }).dropna(subset=["ds", "y"])

    if prophet_df.empty:
        raise ValueError(f"No rows have both a valid date in '{date_col}' and a number in '{metric_col}'.")

    # Monthly totals; months with no data are simply absent (not zero)
    prophet_df["ds"] = prophet_df["ds"].dt.to_period("M").dt.to_timestamp()
    prophet_df = prophet_df.groupby("ds", as_index=False)["y"].sum().sort_values("ds").reset_index(drop=True)

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
    return get_available_metrics(_read_frame(file_path, file_type, sheet_name))


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

    # Revenue/expense can't go below zero, but profit legitimately can:
    # only clip when the history itself never went negative.
    if prophet_df["y"].min() >= 0:
        for col in ("yhat", "yhat_lower", "yhat_upper"):
            forecast[col] = forecast[col].clip(lower=0)

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

    # Year over year growth: latest month vs the same month a year earlier
    # (index -13, the old code used -12 = only 11 months back). Guard against
    # a zero base, which produced inf → JSON error → HTTP 500.
    if len(hist_values) >= 13:
        base = hist_values[-13]
    elif len(hist_values) >= 2:
        base = hist_values[0]
    else:
        base = None
    yoy_growth = float((hist_values[-1] - base) / abs(base) * 100) if base else 0.0

    # Forecast period totals
    forecast_total    = float(future_only["yhat"].sum())
    forecast_best     = float(future_only["yhat_upper"].sum())
    forecast_worst    = float(future_only["yhat_lower"].sum())

    # Confidence score (based on interval width)
    avg_interval = float((future_only["yhat_upper"] - future_only["yhat_lower"]).mean())
    avg_value    = float(future_only["yhat"].mean())
    if not np.isfinite(avg_interval) or not np.isfinite(avg_value) or avg_value <= 0:
        confidence = 50.0
    else:
        confidence = max(0.0, min(100.0, 100 - (avg_interval / (avg_value + 1)) * 100))

    return {
        "metric":          metric,
        "current_value":   round(current_value, 2),
        "next_period":     round(next_value, 2),
        "yoy_growth_pct":  round(float(yoy_growth), 2),
        "forecast_total":  round(forecast_total, 2),
        "forecast_best":   round(forecast_best, 2),
        "forecast_worst":  round(forecast_worst, 2),
        "confidence_pct":  round(float(confidence), 1),
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
