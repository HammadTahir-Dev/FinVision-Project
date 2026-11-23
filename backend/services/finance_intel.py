"""
services/finance_intel.py — Understanding the question before answering it.

  • classify()      → who is asking (finance expert vs. plain-language) and
                      whether the answer needs real numbers or a chart.
  • key_metrics()   → exact figures (revenue, expenses, profit, margin, growth…)
                      computed in pandas, so the AI never has to guess them.
  • build_chart()   → a chart spec the chat UI draws with Recharts.

Nothing here calls the LLM, so results are deterministic and testable.
"""
from __future__ import annotations

import re
from typing import Any, Optional

import numpy as np
import pandas as pd

# ── Vocabulary ────────────────────────────────────────────────────────────────

# term pattern → (display name, plain-English meaning, how to compute)
FINANCE_TERMS: dict[str, tuple[str, str, str]] = {
    r"\bebitda\b":                      ("EBITDA", "profit before interest, taxes, depreciation and amortisation — roughly the cash profit from operations",
                                         "revenue - operating expenses (exclude interest, tax, depreciation, amortisation columns)"),
    r"\bebit\b":                        ("EBIT", "operating profit before interest and tax", "revenue - operating expenses"),
    r"\bgross (?:profit )?margin\b":    ("gross margin", "the share of each sale left after paying the direct cost of what was sold",
                                         "(revenue - cost of goods sold) / revenue * 100"),
    r"\bnet (?:profit )?margin\b":      ("net margin", "the share of revenue left as profit after all costs",
                                         "(revenue - all expenses) / revenue * 100"),
    r"\bprofit margin\b|\bmargin\b":    ("profit margin", "how many cents of profit you keep from every 1 of revenue",
                                         "(revenue - expenses) / revenue * 100"),
    r"\boperating (?:margin|income|profit)\b": ("operating margin", "profit from day-to-day operations as a share of revenue",
                                         "(revenue - operating expenses) / revenue * 100"),
    r"\bcogs\b|cost of (?:goods|sales)": ("COGS", "the direct cost of the products or services sold", "sum of the cost/COGS column"),
    r"\bopex\b|operating expens":       ("OpEx", "the running costs of the business (salaries, rent, utilities…)", "sum of expense columns"),
    r"\bcapex\b|capital expend":        ("CapEx", "money spent on long-term assets like equipment or buildings", "sum of capex column"),
    r"\byoy\b|year[- ]over[- ]year|y-o-y|annual growth": ("YoY growth", "how much a figure changed compared with the same period a year earlier",
                                         "(this period - same period last year) / same period last year * 100"),
    r"\bmom\b|month[- ]over[- ]month":  ("MoM growth", "how much a figure changed compared with the previous month",
                                         "(this month - last month) / last month * 100"),
    r"\bqoq\b|quarter[- ]over[- ]quarter": ("QoQ growth", "change compared with the previous quarter", "quarterly sums, pct_change * 100"),
    r"\bcagr\b|compound annual":        ("CAGR", "the steady yearly growth rate that would take you from the first value to the last",
                                         "(last year / first year) ** (1 / years) - 1"),
    r"\broi\b|return on invest":        ("ROI", "how much you gained compared with what you spent", "(gain - cost) / cost * 100"),
    r"\broe\b|return on equity":        ("ROE", "profit compared with the owners' money in the business", "net income / equity * 100"),
    r"\broa\b|return on assets":        ("ROA", "profit compared with everything the business owns", "net income / total assets * 100"),
    r"\bburn rate\b|\bburn\b":          ("burn rate", "how much money the business loses (spends more than it earns) each month",
                                         "average monthly (expenses - revenue) when negative profit"),
    r"\brun[- ]rate\b|annuali[sz]ed":   ("run rate", "a yearly figure estimated from a recent month or quarter", "latest month * 12"),
    r"\bliquidity\b|current ratio|quick ratio": ("liquidity", "how easily the business can pay short-term bills", "current assets / current liabilities"),
    r"\bdebt[- ]to[- ]equity\b|\bleverage\b": ("debt-to-equity", "how much the business relies on borrowed money", "total debt / equity"),
    r"\bworking capital\b":             ("working capital", "money available for day-to-day operations", "current assets - current liabilities"),
    r"\bcash ?flow\b":                  ("cash flow", "money coming in minus money going out", "inflows - outflows"),
    r"\bbreak[- ]?even\b":              ("break-even", "the point where revenue exactly covers costs", "first period where cumulative profit >= 0"),
    r"\bvariance\b|budget vs":          ("variance", "the gap between actual and planned figures", "actual - budget"),
    r"\bvolatility\b|standard deviation|\bstd\b": ("volatility", "how much a figure jumps around from period to period", "std of the series"),
    r"\bexpense ratio\b|cost ratio":    ("expense ratio", "expenses as a share of revenue", "expenses / revenue * 100"),
    r"\barpu\b|average revenue per":    ("ARPU", "average revenue for each customer or unit", "revenue / number of customers or units"),
    r"\bunit economics\b":              ("unit economics", "revenue and cost for a single unit sold", "revenue / units, cost / units"),
    r"\bseasonality\b|seasonal":        ("seasonality", "patterns that repeat at the same time each year", "average by calendar month"),
}

# Phrases people use when they are not speaking finance
LAYMAN_PATTERNS = [
    r"\bmake (?:any )?money\b", r"\bmaking (?:any )?money\b", r"\bmade (?:any )?money\b", r"\blos(?:e|ing|t) money\b",
    r"\bearn(?:ed|ing)?\b", r"\bspen[dt](?:ing)?\b", r"\bhow (?:are|is) (?:we|the business|the company|it) doing\b",
    r"\bdoing (?:well|ok|okay|good|bad|badly)\b", r"\bgood or bad\b", r"\bin simple (?:words|terms|language)\b",
    r"\bsimply\b", r"\bplain (?:english|words|language)\b", r"\blayman\b", r"\beli5\b", r"\blike i'?m (?:5|five|a beginner)\b",
    r"\bnot (?:a|an) (?:finance|financial|accounting) (?:person|expert)\b", r"\bwhat does .{1,40} mean\b",
    r"\bwhat is (?:a|an) [a-z ]{2,30}\??$", r"\bbiggest (?:cost|expense|spend)\b", r"\bwhere (?:is|does) (?:the|our|my) money go\b",
    r"\bare we (?:ok|okay|fine|profitable)\b", r"\bgoing up or down\b", r"\bgetting better or worse\b", r"\bbeginner\b",
]
PLAIN_REQUEST = re.compile(r"\b(simple|simply|plain|layman|eli5|beginner|easy to understand|non[- ]?technical|explain like)\b", re.I)
EXPERT_REQUEST = re.compile(r"\b(technical(?:ly)?|in detail|detailed analysis|cfa|analyst[- ]level|for my cfo|board[- ]level)\b", re.I)

# Words that mean "this needs numbers from the data"
NUMERIC_HINTS = re.compile(
    r"\b(revenue|sales|income|expense|expenses|cost|costs|spend|spent|profit|loss|margin|growth|grow|grew|trend|"
    r"increase|decrease|compare|comparison|vs|versus|month|monthly|year|yearly|annual|quarter|quarterly|week|"
    r"region|product|category|customer|budget|cash|units|price|amount|ratio|rate|percent|percentage|%|average|"
    r"median|highest|lowest|best|worst|top|bottom|rank|change|forecast|performance|doing|money|earn|earned|"
    r"total|sum|count|how much|how many)\b", re.I)

CHART_WORDS = re.compile(
    r"\b(chart|graph|plot|visuali[sz]e|visuali[sz]ation|diagram|histogram|draw|sketch|figure)\b|"
    r"\b(?:bar|line|pie|donut|doughnut|area)\b(?=.*\b(?:chart|graph|plot)?)|\bshow (?:me )?(?:the )?trend\b|"
    r"\btrend (?:line|over|of)\b|\bover time\b|\bvisually\b", re.I)


def _chart_type(q: str) -> str:
    if re.search(r"\bpie\b|\bdonut\b|\bdoughnut\b|\bshare of\b|\bproportion\b|\bsplit\b", q):
        return "pie"
    if re.search(r"\bbar\b|\bcolumn chart\b|\bhistogram\b", q):
        return "bar"
    if re.search(r"\barea\b", q):
        return "area"
    if re.search(r"\bline\b|\btrend\b|\bover time\b|\bmonthly\b|\bby month\b|\bper month\b|\btimeline\b", q):
        return "line"
    return "auto"


def classify(question: str) -> dict:
    """Who is asking, what they need, and whether to draw a chart."""
    q = (question or "").strip()
    ql = q.lower()
    terms = []
    for pat, (name, meaning, formula) in FINANCE_TERMS.items():
        if re.search(pat, ql) and name not in [t["name"] for t in terms]:
            # "profit margin" shouldn't also add the generic "margin"
            if name == "profit margin" and any(t["name"] in ("gross margin", "net margin", "operating margin") for t in terms):
                continue
            terms.append({"name": name, "meaning": meaning, "formula": formula})
    layman_hits = [p for p in LAYMAN_PATTERNS if re.search(p, ql)]

    if PLAIN_REQUEST.search(ql) or (layman_hits and not terms):
        audience = "plain"
    elif EXPERT_REQUEST.search(ql) or terms:
        audience = "expert"
    else:
        audience = "general"

    wants_chart = bool(CHART_WORDS.search(ql))
    needs_numbers = bool(terms or layman_hits or wants_chart or NUMERIC_HINTS.search(ql))
    return {
        "audience": audience,
        "terms": terms,
        "layman": bool(layman_hits),
        "chart": {"type": _chart_type(ql)} if wants_chart else None,
        "needs_numbers": needs_numbers,
    }


def audience_instructions(info: dict) -> str:
    """Tone/depth instructions for the answer, matched to the person asking."""
    terms = info.get("terms") or []
    if info.get("audience") == "plain":
        text = ("The person asking is NOT a finance specialist. Answer in plain, friendly everyday language: "
                "short sentences, no unexplained jargon, round numbers sensibly, and say what the result means "
                "for them (good / bad / what to watch). If you must use a finance term, explain it in brackets "
                "the first time, e.g. 'profit margin (the share of each sale you keep as profit)'.")
        if terms:
            text += " Briefly explain these terms in everyday words: " + "; ".join(
                f"{t['name']} = {t['meaning']}" for t in terms) + "."
        return text
    if info.get("audience") == "expert":
        text = ("The person asking uses professional finance terminology. Answer like a senior financial analyst: "
                "precise terms, exact figures with units and periods, state the formula or basis used, and note "
                "data limitations (e.g. a metric that can't be computed because a column is missing). "
                "Don't over-explain basic concepts.")
        if terms:
            text += " Definitions to apply: " + "; ".join(f"{t['name']} = {t['formula']}" for t in terms) + "."
        return text
    return ("Answer clearly for a business user: lead with the direct answer and key numbers, then one or two "
            "sentences of context. Explain any finance term you use in a few words.")


def glossary_for_prompt(info: dict) -> str:
    terms = info.get("terms") or []
    if not terms:
        return ""
    return "Finance terms in the question and how to compute them:\n" + "\n".join(
        f"  - {t['name']}: {t['formula']}" for t in terms) + "\n"


# ── Column detection ─────────────────────────────────────────────────────────

_REV = ("revenue", "sales", "income", "turnover", "receipts", "inflow")
_EXP = ("expense", "expenses", "cost", "costs", "cogs", "spend", "expenditure", "opex", "outflow")
_PROFIT = ("profit", "net", "earnings")


def _num_cols(df: pd.DataFrame) -> list:
    return [c for c in df.columns if c != "__source__" and pd.api.types.is_numeric_dtype(df[c])
            and not pd.api.types.is_bool_dtype(df[c])]


def _find(df: pd.DataFrame, keys, exclude=()) -> Optional[str]:
    for c in _num_cols(df):
        n = re.sub(r"[^a-z]", " ", str(c).lower())
        if c not in exclude and any(re.search(rf"\b{k}", n) for k in keys):
            return c
    return None


def _date_col(df: pd.DataFrame) -> Optional[str]:
    try:
        from services.forecast_service import detect_date_column
        return detect_date_column(df.drop(columns=["__source__"], errors="ignore"))
    except Exception:
        return None


def _dates(s: pd.Series) -> pd.Series:
    from services.forecast_service import _to_dates
    return _to_dates(s)


def _fmt(v: float) -> str:
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return "n/a"
    return f"{v:,.2f}".rstrip("0").rstrip(".")


# ── Key metrics (exact, no LLM) ──────────────────────────────────────────────

def key_metrics(df: pd.DataFrame) -> dict:
    """Standard figures computed directly from the data."""
    out: dict[str, Any] = {}
    rev = _find(df, _REV)
    exp = _find(df, _EXP, exclude=(rev,))
    prof = _find(df, _PROFIT, exclude=(rev, exp))
    if not rev and not exp and not prof:
        return out
    if rev:
        out["revenue_column"] = rev
        out["total_revenue"] = float(df[rev].sum())
    if exp:
        out["expense_column"] = exp
        out["total_expenses"] = float(df[exp].sum())
    if rev and exp:
        out["net_profit"] = out["total_revenue"] - out["total_expenses"]
        if out["total_revenue"]:
            out["profit_margin_pct"] = out["net_profit"] / out["total_revenue"] * 100
            out["expense_ratio_pct"] = out["total_expenses"] / out["total_revenue"] * 100
    elif prof:
        out["profit_column"] = prof
        out["net_profit"] = float(df[prof].sum())
        if rev and out.get("total_revenue"):
            out["profit_margin_pct"] = out["net_profit"] / out["total_revenue"] * 100

    dcol = _date_col(df)
    main = rev or prof or exp
    if dcol and main:
        d = _dates(df[dcol])
        frame = pd.DataFrame({"d": d, "v": df[main]})
        if exp and rev:
            frame["p"] = df[rev] - df[exp]
        frame = frame.dropna(subset=["d"])
        if not frame.empty:
            monthly = frame.groupby(frame["d"].dt.to_period("M"))[["v"] + (["p"] if "p" in frame else [])].sum()
            out["date_column"] = dcol
            out["period"] = f"{monthly.index.min()} to {monthly.index.max()}"
            out["months"] = int(len(monthly))
            out["avg_monthly_" + ("revenue" if rev else "value")] = float(monthly["v"].mean())
            out["best_month"] = f"{monthly['v'].idxmax()} ({_fmt(float(monthly['v'].max()))})"
            out["worst_month"] = f"{monthly['v'].idxmin()} ({_fmt(float(monthly['v'].min()))})"
            if len(monthly) >= 2 and monthly["v"].iloc[-2]:
                out["mom_growth_pct"] = float((monthly["v"].iloc[-1] - monthly["v"].iloc[-2]) / abs(monthly["v"].iloc[-2]) * 100)
            if len(monthly) >= 13 and monthly["v"].iloc[-13]:
                out["yoy_growth_pct"] = float((monthly["v"].iloc[-1] - monthly["v"].iloc[-13]) / abs(monthly["v"].iloc[-13]) * 100)
            yearly = frame.groupby(frame["d"].dt.year)["v"].sum()
            if len(yearly) >= 2:
                out["revenue_by_year" if rev else "value_by_year"] = {int(k): float(v) for k, v in yearly.items()}
                first, last = yearly.iloc[0], yearly.iloc[-1]
                full = frame.groupby(frame["d"].dt.year)["d"].apply(lambda s: s.dt.month.nunique())
                if first > 0 and last > 0 and full.iloc[0] == 12 and full.iloc[-1] == 12:
                    out["cagr_pct"] = float(((last / first) ** (1 / (len(yearly) - 1)) - 1) * 100)
            if len(monthly) >= 3:
                out["monthly_volatility_pct"] = float(monthly["v"].std() / abs(monthly["v"].mean()) * 100) if monthly["v"].mean() else None
            if "p" in monthly:
                neg = monthly["p"][monthly["p"] < 0]
                out["loss_months"] = int(len(neg))
                if len(neg):
                    out["avg_monthly_burn"] = float(-neg.mean())
    return {k: v for k, v in out.items() if v is not None}


def metrics_text(m: dict) -> str:
    if not m:
        return ""
    labels = {
        "total_revenue": "Total revenue", "total_expenses": "Total expenses", "net_profit": "Net profit (revenue − expenses)",
        "profit_margin_pct": "Profit margin %", "expense_ratio_pct": "Expense ratio %", "period": "Period covered",
        "months": "Months of data", "avg_monthly_revenue": "Average monthly revenue", "avg_monthly_value": "Average monthly value",
        "best_month": "Best month", "worst_month": "Worst month", "mom_growth_pct": "Latest month-over-month growth %",
        "yoy_growth_pct": "Latest year-over-year growth % (same month last year)", "cagr_pct": "CAGR % (full years)",
        "monthly_volatility_pct": "Monthly volatility (std ÷ mean) %", "loss_months": "Months with a loss",
        "avg_monthly_burn": "Average burn in loss months", "revenue_by_year": "Revenue by year", "value_by_year": "Value by year",
    }
    lines = []
    for k, label in labels.items():
        if k in m:
            v = m[k]
            if isinstance(v, dict):
                v = ", ".join(f"{y}: {_fmt(x)}" for y, x in v.items())
            elif isinstance(v, float):
                v = _fmt(v)
            lines.append(f"  - {label}: {v}")
    cols = [f"{k.split('_')[0]}='{m[k]}'" for k in ("revenue_column", "expense_column", "profit_column", "date_column") if k in m]
    return "Verified key figures computed directly from the data (" + ", ".join(cols) + "):\n" + "\n".join(lines) + "\n"


# ── Charts ────────────────────────────────────────────────────────────────────

MAX_POINTS = 60
MAX_CATEGORIES = 20
MAX_SERIES = 4


def _label(v) -> str:
    if isinstance(v, (pd.Timestamp, np.datetime64)):
        t = pd.Timestamp(v)
        return t.strftime("%Y-%m") if t.day == 1 and t.hour == 0 else t.strftime("%Y-%m-%d")
    if isinstance(v, pd.Period):
        return str(v)
    if isinstance(v, tuple):
        return " / ".join(_label(x) for x in v)
    if isinstance(v, (float, np.floating)) and float(v).is_integer():
        return str(int(v))
    return str(v)


def _num(v) -> Optional[float]:
    try:
        f = float(v)
        return round(f, 4) if np.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _looks_like_time(labels: list[str]) -> bool:
    if not labels:
        return False
    hits = sum(bool(re.fullmatch(r"(19|20)\d\d([-/]\d{1,2}([-/]\d{1,2})?)?|(19|20)\d\dQ[1-4]|Q[1-4] (19|20)\d\d", l)) for l in labels)
    return hits >= max(2, len(labels) * 0.8)


def _pretty(name) -> str:
    return str(name).replace("__source__", "File").replace("_", " ").strip().title() if str(name).islower() or "_" in str(name) else str(name)


def _spec_from_result(result, chart_type: str, title: str) -> Optional[dict]:
    if isinstance(result, pd.Series):
        if not pd.api.types.is_numeric_dtype(result) or len(result) < 2:
            return None
        frame = result.to_frame(name=result.name if result.name is not None else "Value")
    elif isinstance(result, pd.DataFrame):
        frame = result.copy()
        if isinstance(frame.index, pd.RangeIndex):
            text_cols = [c for c in frame.columns if not pd.api.types.is_numeric_dtype(frame[c])]
            dt_cols = [c for c in frame.columns if pd.api.types.is_datetime64_any_dtype(frame[c])]
            key = (dt_cols or text_cols or [None])[0]
            if key is None:
                return None
            frame = frame.set_index(key)
        if len(frame) < 2:
            return None
    else:
        return None

    num = [c for c in frame.columns if pd.api.types.is_numeric_dtype(frame[c]) and not pd.api.types.is_bool_dtype(frame[c])][:MAX_SERIES]
    if not num:
        return None
    labels = [_label(i) for i in frame.index]
    is_time = isinstance(frame.index, (pd.DatetimeIndex, pd.PeriodIndex)) or _looks_like_time(labels)

    if chart_type == "auto":
        chart_type = "line" if is_time else "bar"
    if chart_type == "pie" and (len(num) > 1 or len(frame) > 12 or (frame[num[0]] < 0).any()):
        chart_type = "bar"   # a pie only makes sense for one positive series with few slices

    if is_time:
        frame, labels = frame.iloc[-MAX_POINTS:], labels[-MAX_POINTS:]
    elif len(frame) > MAX_CATEGORIES:
        order = frame[num[0]].abs().sort_values(ascending=False).index[:MAX_CATEGORIES]
        keep = frame.index.isin(order)
        frame, labels = frame[keep], [l for l, k in zip(labels, keep) if k]

    series = [{"key": f"s{i}", "name": _pretty(c)} for i, c in enumerate(num)]
    data = []
    for lab, (_, row) in zip(labels, frame.iterrows()):
        point = {"label": lab}
        for i, c in enumerate(num):
            point[f"s{i}"] = _num(row[c])
        data.append(point)
    x_name = frame.index.name if frame.index.name not in (None, "__source__") else ("File" if frame.index.name == "__source__" else "")
    return {
        "type": chart_type, "title": title, "x_label": _pretty(x_name) if x_name else "",
        "y_label": series[0]["name"] if len(series) == 1 else "", "series": series, "data": data,
    }


def _fallback_spec(df: pd.DataFrame, question: str, chart_type: str, title: str) -> Optional[dict]:
    """When the computed result can't be drawn, build the obvious chart ourselves:
    numbers mentioned in the question over time, or by a category mentioned."""
    ql = question.lower()
    nums = [c for c in _num_cols(df) if re.search(r"\b" + re.escape(str(c).lower()).replace("_", "[ _]?") + r"s?\b", ql)]
    if not nums:
        nums = [c for c in (_find(df, _REV), _find(df, _EXP)) if c] or _num_cols(df)[:1]
    nums = nums[:MAX_SERIES]
    if not nums:
        return None
    cats = [c for c in df.columns if c != "__source__" and not pd.api.types.is_numeric_dtype(df[c])
            and re.search(r"\b" + re.escape(str(c).lower()) + r"s?\b", ql)]
    dcol = _date_col(df)
    if cats and (chart_type in ("bar", "pie") or not re.search(r"\b(month|time|trend|year|quarter|over)\b", ql)):
        grouped = df.groupby(cats[0])[nums].sum().sort_values(nums[0], ascending=False)
        return _spec_from_result(grouped, chart_type if chart_type != "auto" else "bar", title)
    if dcol:
        d = _dates(df[dcol])
        frame = df[nums].copy()
        frame.index = d
        frame = frame[frame.index.notna()]
        if frame.empty:
            return None
        freq = "Q" if re.search(r"\bquarter", ql) else "Y" if re.search(r"\b(year|annual)", ql) else "M"
        grouped = frame.groupby(frame.index.to_period(freq)).sum()
        return _spec_from_result(grouped, chart_type if chart_type != "auto" else "line", title)
    return None


def chart_title(question: str) -> str:
    t = re.sub(r"^(?:please\s+)?(?:can you\s+|could you\s+)?(?:show|plot|draw|make|create|give|display|visuali[sz]e)\s+(?:me\s+)?(?:a|an|the)?\s*",
               "", question.strip(), flags=re.I)
    t = re.sub(r"\b(?:as|in) (?:a|an) (?:\w+ )?(?:chart|graph|plot)\b|\b(?:bar|line|pie|area)?\s*(?:chart|graph|plot) (?:of|for|showing)\s*", "", t, flags=re.I)
    t = t.strip(" ?.!")
    return (t[:1].upper() + t[1:])[:80] if t else "Chart"


def build_chart(result, df: pd.DataFrame, question: str, chart_req: Optional[dict]) -> Optional[dict]:
    if not chart_req:
        return None
    ctype = chart_req.get("type", "auto")
    title = chart_title(question)
    spec = None
    try:
        spec = _spec_from_result(result, ctype, title)
    except Exception:
        spec = None
    if spec is None:
        try:
            spec = _fallback_spec(df, question, ctype, title)
        except Exception:
            spec = None
    return spec


def chart_summary(spec: Optional[dict]) -> str:
    """Short text version of the chart for the LLM's written answer."""
    if not spec:
        return ""
    rows = spec["data"][:MAX_POINTS]
    head = ", ".join(s["name"] for s in spec["series"])
    body = "\n".join(f"  {r['label']}: " + ", ".join(_fmt(r.get(s['key'])) if r.get(s['key']) is not None else "n/a"
                                                     for s in spec["series"]) for r in rows)
    return f"A {spec['type']} chart is shown to the user under your answer ({head} by {spec.get('x_label') or 'label'}):\n{body}\n"


REFERS_BACK = re.compile(r"\b(that|this|it|those|these|same|previous|last|above)\b", re.I)


def restyle_previous(question: str, info: dict, history) -> Optional[dict]:
    """'Show that as a pie chart' → the previous chart's exact data in the new style.
    Only when the question refers back and names nothing new to plot."""
    if not info.get("chart") or not REFERS_BACK.search(question) or len(question) > 90:
        return None
    prev = next((h.get("chart") for h in reversed(history or []) if h.get("role") == "assistant" and h.get("chart")), None)
    if not prev:
        return None
    if NUMERIC_HINTS.search(re.sub(r"\b(chart|graph|plot|bar|line|pie|area|show|as|a|an|that|this|it|instead)\b", "", question.lower())):
        return None      # mentions a new metric/dimension → compute it fresh
    new = dict(prev)
    wanted = info["chart"].get("type", "auto")
    if wanted != "auto":
        new["type"] = wanted
    if new["type"] == "pie" and (len(new["series"]) > 1 or len(new["data"]) > 12 or
                                 any((d.get(new["series"][0]["key"]) or 0) < 0 for d in new["data"])):
        new["type"] = "bar"
    return new
