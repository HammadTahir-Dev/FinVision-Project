"""
services/preprocess_service.py — Natural-language data preprocessing for FinVision.

How a command is handled:
  1. The command is split into steps ("remove duplicates and fill missing values"
     becomes two steps).
  2. Each step is matched by a fast rule-based parser. Common commands never
     need the LLM, so they work instantly and give the same result every time.
  3. Only steps the rules do not understand are sent to the LLM, which must
     answer with a JSON plan using the same small set of operations.
  4. Every step is validated (columns must exist, types must fit). If any step
     fails, nothing is written and the user gets a clear message.
  5. Before the file is overwritten, a snapshot is kept so the change can be
     undone. Excel files keep all their sheets.
"""

from __future__ import annotations

import difflib
import json
import logging
import os
import re
import shutil
import threading
from datetime import date, datetime
from typing import Any, Optional

import numpy as np
import pandas as pd

from config import get_settings
from services.file_utils import read_csv_any

logger = logging.getLogger(__name__)
settings = get_settings()

HISTORY_LIMIT = 10
PREVIEW_ROWS = 8
CSV_KEY = "__csv__"

_file_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


class PreprocessError(Exception):
    """A user-facing problem with a command (bad column, wrong type, etc.)."""


# ═════════════════════════════════════════════════════════════════════════════
# File I/O
# ═════════════════════════════════════════════════════════════════════════════

def _lock_for(path: str) -> threading.Lock:
    with _locks_guard:
        return _file_locks.setdefault(os.path.abspath(path), threading.Lock())


def load_table(path: str, file_type: str, sheet: Optional[str] = None):
    """Return (all_sheets_dict, active_sheet_name). CSV files use a single key."""
    if file_type == "csv":
        df = read_csv_any(path)
        return {CSV_KEY: df}, CSV_KEY
    if file_type == "xlsx":
        sheets = pd.read_excel(path, sheet_name=None)
        if not sheets:
            raise PreprocessError("This workbook has no sheets.")
        name = sheet if sheet in sheets else next(iter(sheets))
        return sheets, name
    raise PreprocessError("Preprocessing only supports CSV and XLSX files.")


def save_table(path: str, file_type: str, sheets: dict) -> None:
    """Write atomically so a crash never leaves a half-written file."""
    ext = ".csv" if file_type == "csv" else ".xlsx"
    tmp = path + ".tmp" + ext
    if file_type == "csv":
        sheets[CSV_KEY].to_csv(tmp, index=False)
    else:
        with pd.ExcelWriter(tmp, engine="openpyxl") as writer:
            for name, frame in sheets.items():
                frame.to_excel(writer, sheet_name=str(name)[:31], index=False)
    os.replace(tmp, path)


# ── Undo history ──────────────────────────────────────────────────────────────

def _history_dir(path: str) -> str:
    return os.path.join(os.path.dirname(path), ".history", os.path.basename(path))


def _snapshots(path: str) -> list[str]:
    d = _history_dir(path)
    if not os.path.isdir(d):
        return []
    return sorted(os.path.join(d, f) for f in os.listdir(d))


def history_count(path: str) -> int:
    return len(_snapshots(path))


def _push_snapshot(path: str) -> None:
    d = _history_dir(path)
    os.makedirs(d, exist_ok=True)
    existing = _snapshots(path)
    nxt = 1
    if existing:
        nxt = int(os.path.splitext(os.path.basename(existing[-1]))[0]) + 1
    shutil.copy2(path, os.path.join(d, f"{nxt:06d}{os.path.splitext(path)[1]}"))
    for old in _snapshots(path)[:-HISTORY_LIMIT]:
        os.remove(old)


def undo_last(path: str) -> bool:
    """Restore the most recent snapshot. Returns False if there is nothing to undo."""
    with _lock_for(path):
        snaps = _snapshots(path)
        if not snaps:
            return False
        shutil.copy2(snaps[-1], path)
        os.remove(snaps[-1])
        return True


def clear_history(path: str) -> None:
    shutil.rmtree(_history_dir(path), ignore_errors=True)


# ═════════════════════════════════════════════════════════════════════════════
# Helpers
# ═════════════════════════════════════════════════════════════════════════════

def _norm(s: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def resolve_column(df: pd.DataFrame, name: Any) -> Any:
    """Match a user-typed column name to a real one (case/spacing/plural tolerant)."""
    n = _norm(name)
    if not n:
        raise PreprocessError("No column name given.")
    lookup = {_norm(c): c for c in df.columns}
    if n in lookup:
        return lookup[n]
    for key, col in lookup.items():
        if key.rstrip("s") == n.rstrip("s"):
            return col
    close = difflib.get_close_matches(n, list(lookup), n=1, cutoff=0.82)
    if close:
        return lookup[close[0]]
    raise PreprocessError(
        f"Column '{name}' not found. Available columns: {', '.join(map(str, df.columns))}"
    )


def find_columns_in_text(df: pd.DataFrame, text: str) -> list:
    """Columns mentioned anywhere in free text, in order of appearance."""
    words = re.findall(r"[A-Za-z0-9_%]+", text.lower())
    grams: list[tuple[int, str]] = []
    for size in (4, 3, 2, 1):
        for i in range(len(words) - size + 1):
            grams.append((i, _norm("".join(words[i:i + size]))))
    found: dict[Any, int] = {}
    for col in df.columns:
        key = _norm(col)
        if not key:
            continue
        for pos, g in grams:
            if g == key or (len(key) > 3 and g.rstrip("s") == key.rstrip("s")):
                found.setdefault(col, pos)
                break
    return sorted(found, key=found.get)


def _numeric_cols(df: pd.DataFrame) -> list:
    return [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and not pd.api.types.is_bool_dtype(df[c])]


def _text_cols(df: pd.DataFrame) -> list:
    return [c for c in df.columns
            if not pd.api.types.is_numeric_dtype(df[c]) and not pd.api.types.is_datetime64_any_dtype(df[c])]


def _parse_value(raw: str) -> Any:
    raw = raw.strip().strip("'\"").strip()
    cleaned = raw.replace(",", "")
    try:
        return int(cleaned)
    except ValueError:
        pass
    try:
        return float(cleaned)
    except ValueError:
        return raw


def _to_number(series: pd.Series) -> pd.Series:
    """Convert text like '$1,200' or '(300)' to numbers; bad cells become NaN."""
    if pd.api.types.is_numeric_dtype(series):
        return series
    s = series.astype("string").str.strip()
    s = s.str.replace(r"^\((.*)\)$", r"-\1", regex=True)
    s = s.str.replace(r"[,$€£₹\s%]", "", regex=True)
    return pd.to_numeric(s, errors="coerce")


def json_safe(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (pd.Timestamp, datetime)):
        if pd.isna(v):
            return None
        return v.strftime("%Y-%m-%d") if (v.hour, v.minute, v.second) == (0, 0, 0) else v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return round(f, 6) if np.isfinite(f) else None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return v if isinstance(v, (int, str)) else str(v)


def preview_of(df: pd.DataFrame, n: int = PREVIEW_ROWS) -> dict:
    head = df.head(n)
    return {
        "columns": [str(c) for c in head.columns],
        "rows": [[json_safe(v) for v in row] for row in head.itertuples(index=False, name=None)],
    }


def profile_of(df: pd.DataFrame) -> dict:
    nulls = df.isnull().sum()
    return {
        "rows": int(len(df)),
        "columns": int(df.shape[1]),
        "total_nulls": int(nulls.sum()),
        "nulls_by_column": {str(c): int(v) for c, v in nulls.items() if v > 0},
        "duplicate_rows": int(df.duplicated().sum()),
        "dtypes": {str(c): ("number" if c in _numeric_cols(df)
                            else "date" if pd.api.types.is_datetime64_any_dtype(df[c]) else "text")
                   for c in df.columns},
    }


# ═════════════════════════════════════════════════════════════════════════════
# Operations — each returns (new_df, description, affected_count)
# ═════════════════════════════════════════════════════════════════════════════

def _cols_param(df, params, key="columns") -> list:
    cols = params.get(key)
    if cols is None and params.get("column") is not None:
        cols = [params["column"]]
    if isinstance(cols, str):
        cols = [cols]
    return [resolve_column(df, c) for c in (cols or [])]


def op_remove_duplicates(df, p):
    subset = _cols_param(df, p) or None
    before = len(df)
    out = df.drop_duplicates(subset=subset).reset_index(drop=True)
    removed = before - len(out)
    scope = f" (based on {', '.join(map(str, subset))})" if subset else ""
    return out, f"Removed {removed} duplicate row{'s' if removed != 1 else ''}{scope}", removed


def op_drop_nulls(df, p):
    cols = _cols_param(df, p) or None
    before = len(df)
    out = df.dropna(subset=cols).reset_index(drop=True)
    removed = before - len(out)
    scope = f" with missing {', '.join(map(str, cols))}" if cols else " containing missing values"
    return out, f"Dropped {removed} row{'s' if removed != 1 else ''}{scope}", removed


def op_fill_nulls(df, p):
    method = str(p.get("method", "value")).lower()
    method = {"average": "mean", "avg": "mean", "forward": "ffill", "backward": "bfill",
              "most_frequent": "mode", "previous": "ffill", "next": "bfill"}.get(method, method)
    explicit = _cols_param(df, p)
    out = df.copy()
    before = int(out.isnull().sum().sum())
    skipped: list[str] = []

    if method in ("mean", "median"):
        cols = explicit or [c for c in _numeric_cols(out) if out[c].isnull().any()]
        for c in cols:
            if c not in _numeric_cols(out):
                skipped.append(str(c))
                continue
            stat = out[c].mean() if method == "mean" else out[c].median()
            out[c] = out[c].fillna(stat)
        label = f"the column {method}"
    elif method == "mode":
        cols = explicit or [c for c in out.columns if out[c].isnull().any()]
        for c in cols:
            m = out[c].mode(dropna=True)
            if not m.empty:
                out[c] = out[c].fillna(m.iloc[0])
        label = "the most frequent value"
    elif method in ("ffill", "bfill"):
        cols = explicit or list(out.columns)
        out[cols] = out[cols].ffill() if method == "ffill" else out[cols].bfill()
        label = "the previous value" if method == "ffill" else "the next value"
    elif method == "interpolate":
        cols = explicit or _numeric_cols(out)
        for c in cols:
            if c in _numeric_cols(out):
                out[c] = out[c].interpolate(limit_direction="both")
        label = "interpolated values"
    else:
        value = p.get("value", 0)
        if isinstance(value, str):
            value = _parse_value(value)
        numeric_value = isinstance(value, (int, float)) and not isinstance(value, bool)
        if explicit:
            cols = explicit
        elif numeric_value:
            cols = _numeric_cols(out)          # 0 goes into number columns
        else:
            cols = _text_cols(out)             # 'Unknown' goes into text columns
        for c in cols:
            if not out[c].isnull().any():
                continue
            if numeric_value and c not in _numeric_cols(out):
                out[c] = out[c].astype("object").fillna(str(value))
            elif not numeric_value and c in _numeric_cols(out):
                skipped.append(str(c))
            else:
                out[c] = out[c].fillna(value)
        label = repr(value) if not numeric_value else str(value)

    filled = before - int(out.isnull().sum().sum())
    desc = f"Filled {filled} missing value{'s' if filled != 1 else ''} with {label}"
    left = int(out.isnull().sum().sum())
    if left:
        left_cols = [str(c) for c in out.columns if out[c].isnull().any()]
        desc += f" ({left} still missing in {', '.join(left_cols)}"
        desc += " — text columns can't use a numeric fill)" if method in ("mean", "median") or skipped else ")"
    return out, desc, filled


def op_drop_columns(df, p):
    cols = _cols_param(df, p)
    if not cols:
        raise PreprocessError("Tell me which column to drop, e.g. 'drop column Units'.")
    return df.drop(columns=cols), f"Dropped column{'s' if len(cols) > 1 else ''} {', '.join(map(str, cols))}", len(cols)


def op_rename_column(df, p):
    col = resolve_column(df, p.get("column"))
    new = str(p.get("new_name", "")).strip().strip("'\"")
    if not new:
        raise PreprocessError("Give the new name, e.g. 'rename Units to Quantity'.")
    if new in df.columns and new != col:
        raise PreprocessError(f"A column called '{new}' already exists.")
    return df.rename(columns={col: new}), f"Renamed '{col}' to '{new}'", 1


def op_normalize(df, p):
    method = str(p.get("method", "minmax")).lower()
    cols = _cols_param(df, p) or _numeric_cols(df)
    if not cols:
        raise PreprocessError("There are no numeric columns to normalize.")
    out = df.copy()
    for c in cols:
        s = _to_number(out[c])
        if s.notna().sum() == 0:
            raise PreprocessError(f"Column '{c}' is not numeric, so it can't be normalized.")
        if method in ("zscore", "standard", "standardize"):
            std = s.std()
            out[c] = ((s - s.mean()) / std) if std else 0.0
        else:
            rng = s.max() - s.min()
            out[c] = ((s - s.min()) / rng) if rng else 0.0
        out[c] = out[c].round(6)
    kind = "Standardized (z-score)" if method in ("zscore", "standard", "standardize") else "Normalized (0–1 min-max)"
    return out, f"{kind}: {', '.join(map(str, cols))}", int(len(out) * len(cols))


_REVENUE = ("revenue", "sales", "income", "turnover", "receipts")
_COST = ("expense", "cost", "cogs", "expenditure", "spend", "outflow")
_PROFIT = ("profit", "net")


def _first_col(df, keys, exclude=()):
    for c in _numeric_cols(df):
        n = _norm(c)
        if c not in exclude and any(k in n for k in keys):
            return c
    return None


def op_profit_margin(df, p):
    out = df.copy()
    rev = resolve_column(out, p["revenue"]) if p.get("revenue") else _first_col(out, _REVENUE)
    if rev is None:
        raise PreprocessError("I need a revenue/sales column to compute profit margin, but none was found. "
                              f"Columns: {', '.join(map(str, out.columns))}")
    prof = resolve_column(out, p["profit"]) if p.get("profit") else _first_col(out, _PROFIT, exclude=(rev,))
    cost = resolve_column(out, p["cost"]) if p.get("cost") else _first_col(out, _COST, exclude=(rev,))
    revenue = _to_number(out[rev]).replace(0, np.nan)
    if prof is not None and not p.get("cost"):
        out_name, margin = p.get("name") or "Profit Margin %", _to_number(out[prof]) / revenue * 100
        basis = f"{prof} ÷ {rev}"
    elif cost is not None:
        out_name, margin = p.get("name") or "Profit Margin %", (revenue - _to_number(out[cost])) / revenue * 100
        basis = f"({rev} − {cost}) ÷ {rev}"
    else:
        raise PreprocessError("I need an expense/cost or profit column to compute profit margin.")
    out[out_name] = margin.round(2)
    return out, f"Added '{out_name}' = {basis} × 100", int(margin.notna().sum())


_SAFE_EXPR = re.compile(r"^[\d\s.+\-*/()]*$")


def op_add_column(df, p):
    name = str(p.get("name", "")).strip()
    expr = str(p.get("expression", "")).strip()
    if not name or not expr:
        raise PreprocessError("Use the form: add column Profit = Revenue - Expense")
    env, work = {}, expr
    for i, col in enumerate(sorted(df.columns, key=lambda c: -len(str(c)))):
        pattern = re.compile(r"(?<![\w])" + re.escape(str(col)) + r"(?![\w])", re.I)
        if pattern.search(work):
            key = f"__c{i}"
            env[key] = _to_number(df[col])
            work = pattern.sub(f" {key} ", work)
    if not env:
        raise PreprocessError(f"The formula doesn't mention any column. Columns: {', '.join(map(str, df.columns))}")
    check = re.sub(r"__c\d+", "", work)
    if not _SAFE_EXPR.match(check):
        raise PreprocessError("Formulas can only use column names, numbers and + − × ÷ ( ).")
    try:
        result = eval(work, {"__builtins__": {}}, env)  # charset validated above
    except ZeroDivisionError:
        raise PreprocessError("The formula divides by zero.")
    except Exception as e:
        raise PreprocessError(f"Could not evaluate the formula: {e}")
    out = df.copy()
    if isinstance(result, pd.Series):
        result = result.replace([np.inf, -np.inf], np.nan)
    out[name] = result
    return out, f"Added column '{name}' = {expr}", int(len(out))


def op_convert_type(df, p):
    col = resolve_column(df, p.get("column"))
    to = str(p.get("dtype", "number")).lower()
    out = df.copy()
    before_nulls = int(out[col].isnull().sum())
    if to in ("number", "numeric", "float", "decimal"):
        out[col] = _to_number(out[col])
        label = "number"
    elif to in ("int", "integer", "whole"):
        out[col] = _to_number(out[col]).round().astype("Int64")
        label = "whole number"
    elif to in ("date", "datetime", "time"):
        out[col] = pd.to_datetime(out[col], errors="coerce")
        label = "date"
    elif to in ("text", "string", "str"):
        out[col] = out[col].astype("string")
        label = "text"
    else:
        raise PreprocessError(f"Unknown type '{to}'. Use number, integer, date or text.")
    bad = int(out[col].isnull().sum()) - before_nulls
    desc = f"Converted '{col}' to {label}"
    if bad > 0:
        desc += f" ({bad} value{'s' if bad != 1 else ''} couldn't be converted and became empty)"
    return out, desc, int(out[col].notna().sum())


_OPS = {
    ">": "gt", "greater than": "gt", "above": "gt", "over": "gt", "more than": "gt",
    "<": "lt", "less than": "lt", "below": "lt", "under": "lt",
    ">=": "ge", "<=": "le", "=": "eq", "==": "eq", "is": "eq", "equals": "eq", "equal to": "eq",
    "!=": "ne", "is not": "ne", "not equal to": "ne", "contains": "contains",
}


def _mask(df, col, op, value):
    s = df[col]
    if op == "isnull":
        return s.isnull()
    if op == "notnull":
        return s.notnull()
    if op == "contains":
        return s.astype("string").str.contains(str(value), case=False, na=False)
    if op in ("gt", "lt", "ge", "le") or (isinstance(value, (int, float)) and pd.api.types.is_numeric_dtype(s)):
        num = _to_number(s)
        if not isinstance(value, (int, float)):
            raise PreprocessError(f"'{value}' is not a number, so it can't be compared with '{col}'.")
        return {"gt": num > value, "lt": num < value, "ge": num >= value, "le": num <= value,
                "eq": num == value, "ne": num != value}[op]
    text = s.astype("string").str.strip().str.lower()
    v = str(value).strip().lower()
    return (text == v).fillna(False) if op == "eq" else (text != v).fillna(True)


def op_filter_rows(df, p):
    col = resolve_column(df, p.get("column"))
    op = p.get("op", "eq")
    op = _OPS.get(op, op)
    value = p.get("value")
    if isinstance(value, str):
        value = _parse_value(value)
    keep = str(p.get("action", "remove")).lower() == "keep"
    mask = _mask(df, col, op, value).astype(bool)
    out = (df[mask] if keep else df[~mask]).reset_index(drop=True)
    removed = len(df) - len(out)
    verb = "Kept only rows" if keep else "Removed rows"
    cond = {"isnull": "is empty", "notnull": "is not empty"}.get(op, f"{op} {value!r}")
    return out, f"{verb} where {col} {cond} ({removed} row{'s' if removed != 1 else ''} removed)", removed


def op_sort(df, p):
    col = resolve_column(df, p.get("column"))
    asc = bool(p.get("ascending", True))
    return (df.sort_values(col, ascending=asc, kind="stable").reset_index(drop=True),
            f"Sorted by {col} ({'ascending' if asc else 'descending'})", len(df))


def op_round(df, p):
    decimals = int(p.get("decimals", 2))
    cols = _cols_param(df, p) or _numeric_cols(df)
    out = df.copy()
    for c in cols:
        if c not in _numeric_cols(out):
            raise PreprocessError(f"Column '{c}' is not numeric, so it can't be rounded.")
        out[c] = out[c].round(decimals)
    return out, f"Rounded {', '.join(map(str, cols))} to {decimals} decimal place{'s' if decimals != 1 else ''}", len(cols)


def op_text_clean(df, p):
    mode = str(p.get("mode", "trim")).lower()
    cols = _cols_param(df, p) or _text_cols(df)
    out = df.copy()
    changed = 0
    for c in cols:
        s = out[c]
        if c not in _text_cols(out):
            continue
        t = s.astype("string")
        if mode == "trim":
            t = t.str.strip().str.replace(r"\s+", " ", regex=True)
        elif mode == "lower":
            t = t.str.lower()
        elif mode == "upper":
            t = t.str.upper()
        elif mode == "title":
            t = t.str.title()
        changed += int((t.fillna("") != s.astype("string").fillna("")).sum())
        out[c] = t
    names = {"trim": "Trimmed extra spaces", "lower": "Lower-cased", "upper": "Upper-cased", "title": "Title-cased"}
    return out, f"{names.get(mode, 'Cleaned')} in {', '.join(map(str, cols)) or 'no text columns'} ({changed} cells changed)", changed


def op_remove_outliers(df, p):
    cols = _cols_param(df, p) or _numeric_cols(df)
    mask = pd.Series(False, index=df.index)
    for c in cols:
        s = _to_number(df[c])
        q1, q3 = s.quantile(0.25), s.quantile(0.75)
        iqr = q3 - q1
        mask |= (s < q1 - 1.5 * iqr) | (s > q3 + 1.5 * iqr)
    out = df[~mask].reset_index(drop=True)
    removed = int(mask.sum())
    return out, f"Removed {removed} outlier row{'s' if removed != 1 else ''} (IQR rule on {', '.join(map(str, cols))})", removed


def op_replace_values(df, p):
    old, new = p.get("old"), p.get("new")
    if old is None:
        raise PreprocessError("Use the form: replace N/A with Unknown in Region")
    cols = _cols_param(df, p) or list(df.columns)
    out = df.copy()
    count = 0
    for c in cols:
        s = out[c]
        hits = s.astype("string").str.strip().str.lower() == str(old).strip().lower()
        hits = hits.fillna(False).astype(bool)
        n = int(hits.sum())
        if n:
            newv = _parse_value(str(new)) if pd.api.types.is_numeric_dtype(s) else new
            out[c] = s.astype("object").where(~hits, newv)
            if pd.api.types.is_numeric_dtype(s) and isinstance(newv, (int, float)):
                out[c] = _to_number(out[c])
            count += n
    return out, f"Replaced {count} occurrence{'s' if count != 1 else ''} of '{old}' with '{new}'", count


# Read-only "info" operations ─────────────────────────────────────────────────

def op_show_missing(df, p):
    prof = profile_of(df)
    if not prof["total_nulls"]:
        return df, "No missing values — every cell is filled.", 0
    parts = [f"{c}: {n}" for c, n in prof["nulls_by_column"].items()]
    return df, f"{prof['total_nulls']} missing values — " + ", ".join(parts), 0


def op_show_duplicates(df, p):
    n = int(df.duplicated().sum())
    return df, f"{n} duplicate row{'s' if n != 1 else ''} found", 0


def op_describe(df, p):
    prof = profile_of(df)
    num = _numeric_cols(df)
    bits = [f"{prof['rows']} rows × {prof['columns']} columns",
            f"{prof['total_nulls']} missing values", f"{prof['duplicate_rows']} duplicate rows"]
    for c in num[:6]:
        s = df[c]
        bits.append(f"{c}: min {json_safe(s.min())}, mean {json_safe(round(s.mean(), 2))}, max {json_safe(s.max())}")
    return df, " · ".join(bits), 0


def op_show_columns(df, p):
    prof = profile_of(df)
    return df, "Columns: " + ", ".join(f"{c} ({t})" for c, t in prof["dtypes"].items()), 0


OPERATIONS = {
    "remove_duplicates": op_remove_duplicates,
    "drop_nulls": op_drop_nulls,
    "fill_nulls": op_fill_nulls,
    "drop_columns": op_drop_columns,
    "drop_column": op_drop_columns,
    "rename_column": op_rename_column,
    "normalize": op_normalize,
    "profit_margin": op_profit_margin,
    "add_column": op_add_column,
    "convert_type": op_convert_type,
    "filter_rows": op_filter_rows,
    "sort": op_sort,
    "round": op_round,
    "text_clean": op_text_clean,
    "remove_outliers": op_remove_outliers,
    "replace_values": op_replace_values,
    "show_missing": op_show_missing,
    "show_duplicates": op_show_duplicates,
    "describe": op_describe,
    "show_columns": op_show_columns,
}
READ_ONLY = {"show_missing", "show_duplicates", "describe", "show_columns"}


# ═════════════════════════════════════════════════════════════════════════════
# Rule-based parser
# ═════════════════════════════════════════════════════════════════════════════

_VERBS = (r"remove|drop|delete|fill|impute|normali[sz]e|standardi[sz]e|scale|rename|add|create|calculate|compute|"
          r"convert|change|cast|sort|order|filter|keep|round|trim|strip|replace|dedup\w*|lower\w*|upper\w*|"
          r"show|display|list|check|describe|summari[sz]e|exclude")
_SPLIT = re.compile(r"\s*(?:;|\bthen\b|,\s*(?:and\s+)?(?:then\s+)?(?=(?:" + _VERBS + r")\b)|\band\s+(?:then\s+)?(?=(?:"
                    + _VERBS + r")\b))\s*", re.I)
_NULL = r"(?:missing|null|nulls|nan|empty|blank|na\b|n/a|gaps?|none)"


def split_command(command: str) -> list[str]:
    parts = [p.strip(" .") for p in _SPLIT.split(command.strip()) if p and p.strip(" .")]
    return parts or [command.strip()]


def _cond(df: pd.DataFrame, text: str) -> Optional[dict]:
    t = text.strip().rstrip(".")
    m = re.match(r"(.+?)\s+(?:is|are)\s+(?:empty|missing|null|blank)$", t, re.I)
    if m:
        return {"column": m.group(1), "op": "isnull"}
    m = re.match(r"(.+?)\s+(?:is|are)\s+negative$", t, re.I)
    if m:
        return {"column": m.group(1), "op": "lt", "value": 0}
    m = re.match(r"(.+?)\s+(?:is|are)\s+(?:zero|0)$", t, re.I)
    if m:
        return {"column": m.group(1), "op": "eq", "value": 0}
    ops = sorted(_OPS, key=len, reverse=True)
    pat = r"(.+?)\s*(" + "|".join(re.escape(o) if o[0] in "<>=!" else r"\b" + re.escape(o) + r"\b" for o in ops) + r")\s*(.+)"
    m = re.match(pat, t, re.I)
    if m:
        return {"column": m.group(1).strip(), "op": m.group(2).lower(), "value": m.group(3).strip()}
    return None


_GENERIC_WORDS = {
    "the", "all", "every", "each", "whole", "entire", "data", "dataset", "table", "file", "sheet", "everything",
    "number", "numbers", "numeric", "numerical", "value", "values", "amount", "amounts", "figure", "figures",
    "it", "them", "this", "these", "column", "columns", "of", "in", "my", "fields", "field", "decimal", "decimals",
}


def _is_generic(target: str) -> bool:
    words = re.findall(r"[a-z]+", target.lower())
    return all(w in _GENERIC_WORDS for w in words)


def _require_named(df: pd.DataFrame, text: str, found: list, verb: str) -> None:
    """If the user named a specific column that doesn't exist, fail loudly instead of
    silently applying the step to every column."""
    if found:
        return
    m = re.search(r"\b" + verb + r"\s+(.+?)(?:\s+columns?)?\s*$", text, re.I)
    if not m:
        return
    target = m.group(1).strip(" .'\"")
    if target and not _is_generic(target):
        resolve_column(df, re.sub(r"^(?:the|column)\s+", "", target, flags=re.I))  # raises with column list


def parse_step(df: pd.DataFrame, step: str) -> Optional[dict]:
    """Return {'operation':..., 'params':{...}} or None if the rules don't understand it."""
    s = step.strip()
    c = s.lower()
    cols = find_columns_in_text(df, s)

    # Info / read-only
    if re.search(r"\b(show|display|list|check|count|how many|find)\b", c):
        if re.search(_NULL, c):
            return {"operation": "show_missing", "params": {}}
        if re.search(r"duplicat", c):
            return {"operation": "show_duplicates", "params": {}}
        if re.search(r"\b(columns?|dtypes?|data types?|schema)\b", c):
            return {"operation": "show_columns", "params": {}}
    if re.search(r"\b(describe|summary|summari[sz]e|statistics|stats|overview|profile)\b", c):
        return {"operation": "describe", "params": {}}

    # Duplicates
    if re.search(r"\bdedup", c) or (re.search(r"\b(remove|drop|delete|eliminate|get rid of)\b", c) and re.search(r"duplicat|dupes?\b", c)):
        sub = cols if re.search(r"\b(based on|by|in|using|on)\b", c) else []
        return {"operation": "remove_duplicates", "params": {"columns": sub}}

    # Fill / impute missing (must come before generic 'replace')
    if re.search(r"\b(fill|impute)\b", c) or (re.search(r"\breplace\b", c) and re.search(_NULL, c)):
        method, value = "value", 0
        if re.search(r"\b(mean|average|avg)\b", c):
            method = "mean"
        elif re.search(r"\bmedian\b", c):
            method = "median"
        elif re.search(r"\b(mode|most (?:frequent|common))\b", c):
            method = "mode"
        elif re.search(r"\b(forward|ffill|previous|prior|last)\b", c):
            method = "ffill"
        elif re.search(r"\b(backward|bfill|next)\b", c):
            method = "bfill"
        elif re.search(r"\binterpolat", c):
            method = "interpolate"
        else:
            m = re.search(r"\bwith\s+(.+?)(?:\s+(?:in|for|on)\s+(?:the\s+)?(?:column\s+)?.+)?$", s, re.I)
            if m:
                value = _parse_value(m.group(1))
                if isinstance(value, str) and re.fullmatch(r"(zeros?|zeroes)", value.lower()):
                    value = 0
        value_cols = set(find_columns_in_text(df, str(value))) if method == "value" and isinstance(value, str) else set()
        target = [col for col in cols if col not in value_cols]
        return {"operation": "fill_nulls", "params": {"method": method, "value": value, "columns": target}}

    # Rows with missing values
    if re.search(r"\b(drop|remove|delete|exclude)\b", c) and re.search(_NULL, c) and \
            (re.search(r"\b(rows?|records?|entries|lines)\b", c) or not re.search(r"\bcolumns?\b", c)):
        return {"operation": "drop_nulls", "params": {"columns": cols}}

    # Filter rows by condition
    m = re.search(r"\b(remove|drop|delete|exclude|filter out|keep|filter|select|only keep|keep only)\b\s+(?:only\s+)?(?:the\s+)?"
                  r"(?:rows?|records?|entries)\s+(?:where|with|whose|that have|having|when)\s+(.+)$", s, re.I)
    if m:
        cond = _cond(df, m.group(2))
        if cond:
            action = "keep" if m.group(1).lower() in ("keep", "filter", "select", "only keep", "keep only") else "remove"
            return {"operation": "filter_rows", "params": {**cond, "action": action}}

    # Profit margin
    if re.search(r"\bmargin\b", c) and re.search(r"\b(add|create|calculate|compute|make|derive|new)\b", c):
        return {"operation": "profit_margin", "params": {}}

    # Add column with a formula
    m = re.search(r"\b(?:add|create|calculate|compute|make|derive)\s+(?:a\s+)?(?:new\s+)?(?:column\s+)?(?:called\s+|named\s+)?"
                  r"['\"]?([\w %]+?)['\"]?\s*(?:=|\bas\b|\bequals?\b)\s*(.+)$", s, re.I)
    if m:
        return {"operation": "add_column", "params": {"name": m.group(1).strip(), "expression": m.group(2).strip()}}

    # Rename
    m = re.search(r"\brename\s+(?:the\s+)?(?:column\s+)?['\"]?(.+?)['\"]?\s+(?:to|as|into)\s+['\"]?(.+?)['\"]?$", s, re.I)
    if m:
        return {"operation": "rename_column", "params": {"column": m.group(1).strip(), "new_name": m.group(2).strip()}}

    # Convert types
    m = re.search(r"\b(?:convert|change|cast|make)\s+(?:the\s+)?(?:column\s+)?(.+?)\s+(?:column\s+)?(?:to|into|as)\s+(?:an?\s+)?"
                  r"(numbers?|numeric|float|decimal|int(?:eger)?s?|whole numbers?|dates?|datetime|text|strings?)\b", s, re.I)
    if m:
        to = m.group(2).lower().rstrip("s")
        to = {"whole number": "int", "integer": "int", "datetime": "date", "string": "text"}.get(to, to)
        return {"operation": "convert_type", "params": {"column": m.group(1).strip(), "dtype": to}}

    # Normalize / standardize
    if re.search(r"\b(normali[sz]e|standardi[sz]e|scale|min.?max|z.?score)", c):
        method = "zscore" if re.search(r"standardi|z.?score", c) else "minmax"
        _require_named(df, s, cols, r"(?:normali[sz]e|standardi[sz]e|scale)")
        return {"operation": "normalize", "params": {"columns": cols, "method": method}}

    # Outliers
    if re.search(r"\boutliers?\b", c):
        _require_named(df, s, cols, r"outliers?\s+(?:in|from|of|for)")
        return {"operation": "remove_outliers", "params": {"columns": cols}}

    # Drop columns
    if re.search(r"\b(drop|remove|delete)\b", c) and (re.search(r"\bcolumns?\b", c) or cols):
        if cols:
            return {"operation": "drop_columns", "params": {"columns": cols}}
        m = re.search(r"\b(?:drop|remove|delete)\s+(?:the\s+)?(?:columns?\s+)?['\"]?(.+?)['\"]?(?:\s+columns?)?$", s, re.I)
        if m:
            return {"operation": "drop_columns", "params": {"columns": [m.group(1)]}}

    # Sort
    m = re.search(r"\b(?:sort|order)\b.*?\bby\s+(.+?)(?:\s+(asc\w*|desc\w*|highest first|lowest first|largest first|smallest first))?$", s, re.I)
    if m:
        direction = (m.group(2) or "") + " " + c
        asc = not re.search(r"desc|highest first|largest first|high to low|biggest", direction)
        return {"operation": "sort", "params": {"column": m.group(1).strip(), "ascending": asc}}

    # Round
    if re.search(r"\bround\b", c):
        m = re.search(r"(\d+)\s*(?:decimal|dp|places?|digits?)", c)
        _require_named(df, re.sub(r"\s+to\s+\d+.*$", "", s, flags=re.I), cols, r"round")
        return {"operation": "round", "params": {"columns": cols, "decimals": int(m.group(1)) if m else 2}}

    # Text cleanup
    if re.search(r"\b(trim|strip)\b|whitespace|extra spaces", c):
        return {"operation": "text_clean", "params": {"mode": "trim", "columns": cols}}
    if re.search(r"\blower.?case|\blowercase|\bto lower\b", c):
        return {"operation": "text_clean", "params": {"mode": "lower", "columns": cols}}
    if re.search(r"\bupper.?case|\buppercase|\bto upper\b", c):
        return {"operation": "text_clean", "params": {"mode": "upper", "columns": cols}}
    if re.search(r"\btitle.?case|capitali[sz]e", c):
        return {"operation": "text_clean", "params": {"mode": "title", "columns": cols}}

    # Replace values
    m = re.search(r"\breplace\s+['\"]?(.+?)['\"]?\s+with\s+['\"]?(.+?)['\"]?(?:\s+in\s+(?:the\s+)?(?:column\s+)?(.+))?$", s, re.I)
    if m:
        return {"operation": "replace_values",
                "params": {"old": m.group(1), "new": m.group(2), "columns": [m.group(3)] if m.group(3) else []}}

    return None


# ═════════════════════════════════════════════════════════════════════════════
# LLM fallback
# ═════════════════════════════════════════════════════════════════════════════

LLM_SYSTEM = """You turn a data-cleaning request into a JSON plan for a pandas dataframe.
Reply with ONE JSON object and nothing else:
{"steps":[{"operation":"<name>","params":{...}}],"description":"<short summary>"}

Allowed operations and params (use exact column names from the schema):
- remove_duplicates {"columns":[optional subset]}
- drop_nulls {"columns":[optional]}
- fill_nulls {"method":"value|mean|median|mode|ffill|bfill|interpolate","value":<for method value>,"columns":[optional]}
- drop_columns {"columns":[...]}
- rename_column {"column":"old","new_name":"new"}
- normalize {"columns":[optional],"method":"minmax|zscore"}
- profit_margin {"revenue":"col","cost":"col" or "profit":"col"}
- add_column {"name":"new col","expression":"arithmetic using column names, + - * / ( ) and numbers"}
- convert_type {"column":"col","dtype":"number|int|date|text"}
- filter_rows {"column":"col","op":"gt|lt|ge|le|eq|ne|contains|isnull|notnull","value":<v>,"action":"remove|keep"}
- sort {"column":"col","ascending":true|false}
- round {"columns":[optional],"decimals":2}
- text_clean {"mode":"trim|lower|upper|title","columns":[optional]}
- remove_outliers {"columns":[optional]}
- replace_values {"old":"x","new":"y","columns":[optional]}
- show_missing {} | show_duplicates {} | describe {} | show_columns {}
If the request cannot be done with these operations, reply {"steps":[],"description":"<why>"}."""


def _extract_json(text: str) -> Optional[dict]:
    if not text:
        return None
    t = re.sub(r"```(?:json)?", "", text).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    start, end = t.find("{"), t.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(t[start:end + 1])
        except json.JSONDecodeError:
            return None
    return None


def llm_plan(step: str, df: pd.DataFrame, db_settings: Optional[dict] = None) -> dict:
    from services.rag_service import get_groq_client  # local import keeps tests/stubs simple

    prof = profile_of(df)
    schema = "\n".join(f"- {c} ({t}, {prof['nulls_by_column'].get(str(c), 0)} missing)" for c, t in prof["dtypes"].items())
    sample = df.head(3).to_string(index=False)[:1500]
    model = (db_settings or {}).get("llm_model") or settings.default_llm_model
    messages = [
        {"role": "system", "content": LLM_SYSTEM},
        {"role": "user", "content": f"Schema ({prof['rows']} rows):\n{schema}\n\nSample:\n{sample}\n\nRequest: {step}"},
    ]
    base = {"model": model, "messages": messages, "temperature": 0}
    # Reasoning models (gpt-oss) spend tokens thinking before answering. A small
    # max_tokens left the answer EMPTY, which caused "Expecting value: line 1
    # column 1 (char 0)". Give enough room, ask for JSON mode, and fall back.
    attempts = [{"max_tokens": 2048, "response_format": {"type": "json_object"}}, {"max_tokens": 2048}]
    if "gpt-oss" in str(model) or "qwen" in str(model).lower():
        attempts.insert(0, {**attempts[0], "reasoning_effort": "low"})
    client = get_groq_client()
    last_err: Optional[Exception] = None
    for extra in attempts:
        try:
            resp = client.chat.completions.create(**base, **extra)
            plan = _extract_json(resp.choices[0].message.content or "")
            if plan is not None:
                if "operation" in plan and "steps" not in plan:      # single-step shape
                    plan = {"steps": [{"operation": plan["operation"], "params": plan.get("params", {})}],
                            "description": plan.get("description", "")}
                return plan
        except Exception as e:  # unsupported param, rate limit, network...
            last_err = e
            logger.warning("Preprocess LLM attempt failed (%s): %s", list(extra), e)
    if last_err and "api" in str(last_err).lower() and "key" in str(last_err).lower():
        raise PreprocessError("The AI service rejected the API key. Check GROQ_API_KEY in backend/.env.")
    raise PreprocessError("I couldn't understand that command.")


# ═════════════════════════════════════════════════════════════════════════════
# Entry points
# ═════════════════════════════════════════════════════════════════════════════

EXAMPLES = ("Try: \"remove duplicate rows\", \"fill missing values with mean\", \"drop rows with null values\", "
            "\"normalize Revenue\", \"rename Units to Quantity\", \"add column Profit = Revenue - Expense\", "
            "\"remove rows where Revenue < 0\", \"sort by Date descending\", \"show missing values\".")


def plan_command(command: str, df: pd.DataFrame, db_settings: Optional[dict] = None,
                 allow_llm: bool = True) -> tuple[list[dict], str]:
    """Turn a command into validated steps. Returns (steps, parsed_by)."""
    steps, used_llm = [], False
    for part in split_command(command):
        rule = parse_step(df, part)
        if rule:
            steps.append({**rule, "text": part})
            continue
        if not allow_llm:
            raise PreprocessError(f"I couldn't understand \"{part}\". {EXAMPLES}")
        try:
            plan = llm_plan(part, df, db_settings)
        except PreprocessError as e:
            raise PreprocessError(f"{e} (\"{part}\"). {EXAMPLES}")
        used_llm = True
        llm_steps = plan.get("steps") or []
        if not llm_steps:
            why = plan.get("description") or "That isn't a supported preprocessing action."
            raise PreprocessError(f"{why} {EXAMPLES}")
        for st in llm_steps:
            if st.get("operation") not in OPERATIONS:
                raise PreprocessError(f"Unsupported operation '{st.get('operation')}'. {EXAMPLES}")
            steps.append({"operation": st["operation"], "params": st.get("params") or {}, "text": part})
    return steps, ("ai" if used_llm else "rules")


def run_preprocess(command: str, file_path: str, file_type: str, sheet: Optional[str] = None,
                   db_settings: Optional[dict] = None) -> dict:
    command = (command or "").strip()
    if not command:
        return {"success": False, "error": "Please type a command."}
    if len(command) > 1000:
        return {"success": False, "error": "Command is too long (max 1000 characters)."}
    if not os.path.exists(file_path):
        return {"success": False, "error": "The file is missing on the server. Please re-upload it."}

    with _lock_for(file_path):
        try:
            sheets, active = load_table(file_path, file_type, sheet)
        except PreprocessError as e:
            return {"success": False, "error": str(e)}
        except Exception as e:
            logger.exception("Could not read %s", file_path)
            return {"success": False, "error": f"Could not read the file: {e}"}

        df = sheets[active]
        before = profile_of(df)
        try:
            steps, parsed_by = plan_command(command, df, db_settings)
            results, work = [], df
            for st in steps:
                work, desc, affected = OPERATIONS[st["operation"]](work, st["params"])
                results.append({"operation": st["operation"], "description": desc,
                                "affected": int(affected), "command": st["text"]})
        except PreprocessError as e:
            return {"success": False, "error": str(e), "can_undo": history_count(file_path) > 0}
        except Exception as e:
            logger.exception("Preprocessing failed for command %r", command)
            return {"success": False, "error": f"Could not apply that command: {e}",
                    "can_undo": history_count(file_path) > 0}

        changed = any(r["operation"] not in READ_ONLY for r in results)
        if changed:
            _push_snapshot(file_path)
            sheets[active] = work
            try:
                save_table(file_path, file_type, sheets)
            except Exception as e:
                undo_last(file_path)
                logger.exception("Save failed")
                return {"success": False, "error": f"Could not save the file: {e}"}

        after = profile_of(work)
        return {
            "success": True,
            "changed": changed,
            "parsed_by": parsed_by,
            "operation": ", ".join(r["operation"] for r in results),
            "description": "; ".join(r["description"] for r in results),
            "steps": results,
            "sheet": None if active == CSV_KEY else str(active),
            "sheets": [] if active == CSV_KEY else [str(s) for s in sheets],
            "before_shape": [before["rows"], before["columns"]],
            "after_shape": [after["rows"], after["columns"]],
            "before_nulls": before["total_nulls"],
            "after_nulls": after["total_nulls"],
            "profile": after,
            "preview": preview_of(work),
            "can_undo": history_count(file_path) > 0,
            "file_size": os.path.getsize(file_path),
        }


def describe_file(file_path: str, file_type: str, sheet: Optional[str] = None) -> dict:
    """Current preview + data-quality profile (used when a file is selected)."""
    sheets, active = load_table(file_path, file_type, sheet)
    df = sheets[active]
    return {
        "sheet": None if active == CSV_KEY else str(active),
        "sheets": [] if active == CSV_KEY else [str(s) for s in sheets],
        "profile": profile_of(df),
        "preview": preview_of(df),
        "can_undo": history_count(file_path) > 0,
    }
