"""
rag_service.py — Complete RAG pipeline with file-aware routing.
Handles: single file, multi-file same schema, multi-file different schema.
Supports 10-15 active files with intelligent query routing.
"""
import os, logging, time, json
import numpy as np
import re
from services import finance_intel as fi
import pandas as pd
from services.file_utils import read_csv_any
import fitz
import chromadb
from chromadb.config import Settings as ChromaSettings
from sentence_transformers import SentenceTransformer
from groq import Groq
from config import get_settings

logger   = logging.getLogger(__name__)
settings = get_settings()

# ── Singletons ────────────────────────────────────────────────────────────────
_embedder, _chroma_client, _chroma_col, _groq = None, None, None, None

def get_embedder():
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Embedding model loaded")
    return _embedder

def get_chroma_collection():
    global _chroma_client, _chroma_col
    if _chroma_col is None:
        _chroma_client = chromadb.PersistentClient(
            path=settings.chroma_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        _chroma_col = _chroma_client.get_or_create_collection(
            name="finvision_docs",
            metadata={"hnsw:space": "cosine"},
        )
        logger.info("ChromaDB ready (%d chunks)", _chroma_col.count())
    return _chroma_col

def get_groq_client():
    global _groq
    if _groq is None:
        _groq = Groq(api_key=settings.groq_api_key)
        logger.info("Groq client initialized")
    return _groq

# ── File Parsers ──────────────────────────────────────────────────────────────
def _parse_csv(path):
    df = read_csv_any(path).fillna("")
    chunks = [{"text": "Columns: " + ", ".join(df.columns.tolist()) + "\nTotal rows: " + str(len(df)), "page": 0}]
    for i in range(0, len(df), 50):
        chunks.append({"text": df.iloc[i:i+50].to_string(index=False), "page": i//50+1})
    return chunks

def _parse_xlsx(path):
    xl = pd.ExcelFile(path)
    chunks = []
    for sheet in xl.sheet_names:
        df = xl.parse(sheet).fillna("")
        chunks.append({"text": "Sheet: " + sheet + "\nColumns: " + ", ".join(df.columns.astype(str).tolist()), "page": 0})
        for i in range(0, len(df), 50):
            chunks.append({"text": "[Sheet: " + sheet + "]\n" + df.iloc[i:i+50].to_string(index=False), "page": i//50+1})
    return chunks

def _parse_pdf(path):
    doc = fitz.open(path)
    chunks = []
    for pn in range(len(doc)):
        text = doc[pn].get_text("text").strip()
        if not text:
            continue
        for part in text.split("\n\n"):
            if part.strip():
                chunks.append({"text": part.strip(), "page": pn+1})
    doc.close()
    return chunks

def _chunk_text(text, size, overlap):
    if len(text) <= size:
        return [text]
    out, s = [], 0
    while s < len(text):
        out.append(text[s:s+size])
        s += size - overlap
    return out

# ── Ingestion ─────────────────────────────────────────────────────────────────
def ingest_file(file_id, file_path, file_type, user_id, filename):
    parsers = {"csv": _parse_csv, "xlsx": _parse_xlsx, "pdf": _parse_pdf}
    raw     = parsers[file_type.lower()](file_path)
    size    = settings.default_chunk_size
    overlap = settings.default_chunk_overlap

    all_chunks = []
    for r in raw:
        for sub in _chunk_text(r["text"], size, overlap):
            if sub.strip():
                all_chunks.append({"text": sub.strip(), "page": r["page"]})

    if not all_chunks:
        raise ValueError("No text extracted from file")

    col  = get_chroma_collection()
    emb  = get_embedder()
    total = 0
    for i in range(0, len(all_chunks), 50):
        batch  = all_chunks[i:i+50]
        texts  = [c["text"] for c in batch]
        vecs   = emb.encode(texts, show_progress_bar=False).tolist()
        ids    = ["f" + str(file_id) + "_c" + str(i+j) for j in range(len(batch))]
        metas  = [{"file_id": str(file_id), "user_id": str(user_id), "filename": filename, "page": str(c["page"]), "chunk_idx": str(i+j)} for j,c in enumerate(batch)]
        col.add(ids=ids, embeddings=vecs, documents=texts, metadatas=metas)
        total += len(batch)

    logger.info("Ingested file %d: %d chunks", file_id, total)
    return total

def delete_file_chunks(file_id):
    col = get_chroma_collection()
    res = col.get(where={"file_id": str(file_id)})
    ids = res.get("ids", [])
    if ids:
        col.delete(ids=ids)
    logger.info("Deleted %d chunks for file %d", len(ids), file_id)
    return len(ids)

# ── File-Aware Routing ────────────────────────────────────────────────────────
DOMAIN_MAP = {
    "revenue":    ["revenue","sales","income","turnover"],
    "expense":    ["expense","cost","expenditure","spending"],
    "profit":     ["profit","net","margin","earning"],
    "stock_in":   ["stock_in","received","inbound"],
    "stock_out":  ["stock_out","sold","outbound"],
    "stock":      ["stock","inventory","quantity","units"],
    "product":    ["product","item","sku","goods"],
    "manager":    ["manager","employee","staff"],
    "country":    ["country","region","location"],
    "supplier":   ["supplier","vendor"],
    "shipment":   ["shipment","delivery"],
    "priority":   ["priority","urgency"],
    "unit_cost":  ["unit_cost","price","rate"],
    "date":       ["date","month","year","period"],
    "category":   ["category","type","department"],
    "order":      ["order","order_id","transaction"],
    "salary":     ["salary","salaries","payroll","wage"],
}

ALL_KEYWORDS = [
    "all files","all sources","combined","across all",
    "overall","every file","compare files","from all","between files",
]

AGGREGATION_KEYWORDS = [
    "total","sum","how much","how many","count","average","mean",
    "maximum","minimum","highest","lowest","all","across all",
    "grand total","overall","entire","combined","aggregate",
    "which product","which country","which manager","which supplier",
    "who has","most orders","most stock","top product","top country",
    "top manager","ranked","per product","per country","breakdown",
    "summary","overview","summarize","give me","show me","what are",
    "analyze","analyse","tell me about","describe","report",
]

def _read_cols(file_path, file_type):
    try:
        if file_type == "csv":
            df = read_csv_any(file_path, nrows=2)
        elif file_type == "xlsx":
            df = pd.read_excel(file_path, nrows=2)
        else:
            return []
        return [str(c).lower().strip() for c in df.columns]
    except Exception as e:
        logger.warning("Could not read columns for %s: %s", file_path, e)
        return []

def _score_file(question, cols):
    q = question.lower()
    score = 0.0
    for col in cols:
        if col.replace("_"," ") in q or col in q:
            score += 0.45
    for domain, keywords in DOMAIN_MAP.items():
        if any(kw in q for kw in [domain]+keywords):
            if any(any(kw in col for kw in keywords) for col in cols):
                score += 0.3
    return min(score, 1.0)

def _route_files(question, file_records):
    """Route question to the most relevant file(s) from 1-15 files."""
    if not file_records:
        return [], "none"
    if len(file_records) == 1:
        return file_records, "single"

    q = question.lower()
    if any(kw in q for kw in ALL_KEYWORDS):
        return file_records, "all"

    scored = []
    for fr in file_records:
        cols  = _read_cols(fr.file_path, fr.file_type.value)
        score = _score_file(question, cols)
        scored.append((fr, score, cols))
        logger.info("File '%s' relevance=%.2f", fr.original_name, score)

    scored.sort(key=lambda x: x[1], reverse=True)

    # Clear single winner
    if len(scored) >= 2 and (scored[0][1] - scored[1][1]) > 0.35:
        return [scored[0][0]], "single"

    # Multiple relevant files
    high = [x for x in scored if x[1] >= 0.3]
    if len(high) >= 2:
        c1 = set(high[0][2])
        c2 = set(high[1][2])
        if len(c1 & c2) >= max(2, len(c1)*0.35):
            return [x[0] for x in high], "multi_same"
        return [x[0] for x in high[:2]], "multi_diff"

    if scored[0][1] > 0.1:
        return [scored[0][0]], "single"

    return file_records, "all"

# ── LLM helper ────────────────────────────────────────────────────────────────
def llm_complete(messages, model, max_tokens=1024, temperature=0.2, **extra):
    """
    Call Groq and return the reply text ('' if the model returned nothing).
    gpt-oss / qwen are reasoning models: their hidden reasoning counts against
    max_tokens, so small limits (the old 200/400) often produced EMPTY replies.
    We ask for low reasoning effort and give enough room; if the API rejects an
    optional parameter we retry without it.
    """
    client = get_groq_client()
    base = {"model": model, "messages": messages, "temperature": temperature,
            "max_tokens": max(int(max_tokens or 1024), 1024)}
    base.update({k: v for k, v in extra.items() if v is not None})
    attempts = [base]
    if "gpt-oss" in str(model) or "qwen" in str(model).lower():
        attempts.insert(0, {**base, "reasoning_effort": "low"})
    if "top_p" in base:
        attempts.append({k: v for k, v in base.items() if k != "top_p"})
    last = None
    for kw in attempts:
        try:
            resp = client.chat.completions.create(**kw)
            return (resp.choices[0].message.content or "").strip()
        except TypeError as e:          # SDK doesn't know a parameter
            last = e
        except Exception as e:          # API rejected a parameter
            last = e
            if "reasoning" not in str(e).lower() and "top_p" not in str(e).lower():
                raise
    raise last


def _tabular_records(records):
    return [r for r in records if r.file_type.value in ("csv", "xlsx")]


def _load_table_for_question(fr, question):
    """CSV: the file. XLSX: the sheet whose columns best match the question."""
    if fr.file_type.value == "csv":
        return read_csv_any(fr.file_path)
    sheets = pd.read_excel(fr.file_path, sheet_name=None)
    if len(sheets) == 1:
        return next(iter(sheets.values()))
    scored = [(_score_file(question, [str(c).lower() for c in d.columns]), i, d) for i, d in enumerate(sheets.values())]
    scored.sort(key=lambda x: (-x[0], x[1]))
    return scored[0][2]


def _load_files(file_records, mode, question=""):
    dfs, names = [], []
    for fr in file_records:
        try:
            if fr.file_type.value not in ("csv", "xlsx"):
                continue
            df = _load_table_for_question(fr, question)
            df.columns = [str(c) for c in df.columns]
            df["__source__"] = fr.original_name
            # NOTE: no fillna(0) — it turned missing text into 0 (and crashes on
            # pandas 3 string columns). pandas sums/means already skip NaN.
            dfs.append(df)
            names.append(fr.original_name)
        except Exception as e:
            logger.warning("Load failed '%s': %s", fr.original_name, e)

    if not dfs:
        return pd.DataFrame(), []
    if len(dfs) == 1:
        return dfs[0], names
    try:
        return pd.concat(dfs, ignore_index=True, sort=False), names
    except Exception:
        return dfs[0], [names[0]]


def _build_schema(df, filenames):
    cols = [c for c in df.columns if c != "__source__"]
    lines = []
    for c in cols:
        non_null = df[c].dropna()
        sample = str(non_null.iloc[0])[:40] if len(non_null) else "N/A"
        missing = int(df[c].isna().sum())
        lines.append(f"  - {c} ({df[c].dtype}{', ' + str(missing) + ' missing' if missing else ''}) e.g. '{sample}'")

    cat_lines = []
    for c in cols:
        if pd.api.types.is_numeric_dtype(df[c]) or pd.api.types.is_datetime64_any_dtype(df[c]):
            continue
        try:
            cat_lines.append(f"  - {c}: {df[c].dropna().astype(str).unique()[:6].tolist()}")
        except Exception:
            pass

    src = ""
    if len(filenames) > 1:
        src = f"\nMerged files ({len(filenames)}): {', '.join(filenames)}\n__source__ column = filename per row\n"
    result = f"Shape: {len(df)} rows x {len(cols)} cols{src}\nColumns:\n" + "\n".join(lines)
    if cat_lines:
        result += "\nCategorical:\n" + "\n".join(cat_lines)
    return result

# ── Pandas Query Engine ───────────────────────────────────────────────────────
PANDAS_PROMPT = """You are a Python/pandas expert for financial data analysis.
Write ONE pandas expression that completely answers the question.

RULES:
1. Return ONLY the expression — no markdown, no explanation, no assignment
2. Dataframe is `df`. Column `__source__` = filename of each row. `pd` and `np` are available.
3. For 'which X has most/highest' — return BOTH name AND value:
   GOOD: df.groupby('Country').size().sort_values(ascending=False).head(5)
   GOOD: df.loc[df['Unit_Cost'].idxmax(), ['Product','Unit_Cost','__source__']]
   BAD:  df['Country'].value_counts().idxmax()
4. For totals: df['Col'].sum()
5. Per-file breakdown: df.groupby('__source__')['Col'].sum()
6. String filter: use .str.lower()
7. NEVER use .idxmax() alone — always select columns too
8. For counts: .value_counts() or .groupby().size()
9. For 'summary' or 'overview' requests across multiple files:
   df.groupby('__source__').agg({'col1':'sum', 'col2':'sum'}).reset_index()
   Pick the most relevant numeric columns from the schema.
10. Dates may be stored as text: use pd.to_datetime(df['Date']) when grouping by month/year.
11. Only use df, pd and np. Never read or write files. No imports, no dunder attributes.
12. Finance terms → formulas (use the matching columns from the schema):
    profit / net income = revenue − expenses;  profit margin % = (revenue − expenses) / revenue * 100
    gross margin % = (revenue − COGS) / revenue * 100;  expense ratio % = expenses / revenue * 100
    MoM / YoY growth = pct_change of monthly sums (periods=1 / periods=12) * 100
    CAGR = (last full year / first full year) ** (1 / years) − 1;  run rate = latest month * 12
    burn rate = average monthly (expenses − revenue) in months with a loss
    If a metric needs a column that does not exist, return a string saying which column is missing.
13. Everyday questions map to the same metrics: "did we make money" = profit; "where does the money go" =
    expenses grouped by category; "how are we doing" = revenue, expenses, profit and growth together, e.g.
    pd.Series({'revenue': df['Revenue'].sum(), 'expenses': df['Expense'].sum(), 'profit': df['Revenue'].sum() - df['Expense'].sum()})
14. CHART REQUESTS (chart, graph, plot, trend, visualise): return a Series or DataFrame indexed by the x-axis
    (month, quarter, year or category) with numeric values — never a single number. Over time:
    df.groupby(pd.to_datetime(df['Date']).dt.to_period('M').astype(str))[['Revenue']].sum()
    By category: df.groupby('Region')['Revenue'].sum().sort_values(ascending=False)"""


def is_aggregation_query(question):
    q = question.lower()
    return any(kw in q for kw in AGGREGATION_KEYWORDS)


HISTORY_TURNS = 6          # earlier messages sent to the model for follow-up questions
HISTORY_CHARS = 1500       # per message, so long answers don't crowd out the context


def _history_messages(history):
    """Earlier turns of this chat session in the LLM's message format."""
    out = []
    for h in (history or [])[-HISTORY_TURNS:]:
        role = "assistant" if h.get("role") == "assistant" else "user"
        text = (h.get("content") or "").strip()
        if text:
            out.append({"role": role, "content": text[:HISTORY_CHARS]})
    return out


def _history_text(history):
    lines = [f"{m['role'].upper()}: {m['content'][:400]}" for m in _history_messages(history)]
    return ("Earlier in this conversation:\n" + "\n".join(lines) + "\n\n") if lines else ""


def _chart_question(question, history):
    """'Show that as a pie chart' → reuse the previous question's subject for the chart."""
    if re.search(r"\b(that|this|it|those|these|same)\b", question.lower()) and len(question) < 80:
        prev = next((h.get("content", "") for h in reversed(history or []) if h.get("role") == "user"), "")
        if prev:
            return prev + " — " + question
    return question


def run_pandas_query(question, active_file_ids, user_id, db_settings, history=None, info=None):
    """Answer with real computation over CSV/XLSX data. Returns None when this
    path can't answer (no tabular files / code keeps failing) so the caller
    can fall back to document retrieval."""
    from database import SessionLocal
    from models.db_models import UploadedFile
    from services.safe_eval import clean_code, safe_eval, result_to_text, UnsafeExpression

    db        = SessionLocal()
    llm_model = db_settings.get("llm_model") or settings.default_llm_model
    start     = time.time()

    try:
        records = db.query(UploadedFile).filter(
            UploadedFile.id.in_(active_file_ids),
            UploadedFile.user_id == user_id,
        ).all()
        records = _tabular_records(records)
        if not records:
            return None

        selected, mode = _route_files(question, records)
        logger.info("Route mode: %s | Files: %s", mode, [f.original_name for f in selected])

        df, filenames = _load_files(selected, mode, question)
        if df.empty:
            return None

        schema    = _build_schema(df, filenames)
        citations = []
        for name in filenames:
            row_count = int((df["__source__"] == name).sum()) if "__source__" in df.columns else len(df)
            citations.append({"source": name, "page": "Full dataset", "snippet": f"{row_count} rows analyzed", "relevance": 100.0})

        info    = info or fi.classify(question)
        data_df = df.drop(columns=["__source__"]) if len(filenames) == 1 and "__source__" in df.columns else df
        try:
            metrics = fi.key_metrics(data_df)
        except Exception as e:
            logger.warning("Key metrics failed: %s", e)
            metrics = {}
        metrics_block = fi.metrics_text(metrics)
        chart_req = info.get("chart")

        messages = [
            {"role": "system", "content": PANDAS_PROMPT},
            {"role": "user",   "content": "Schema:\n" + schema + "\n\n" + fi.glossary_for_prompt(info)
                                          + ("The user wants a CHART — return a Series/DataFrame for plotting (rule 14).\n" if chart_req else "")
                                          + _history_text(history)
                                          + "Question: " + question + "\n\nPandas expression:"},
        ]
        result_str, code, raw = None, "", None
        for attempt in range(2):            # one retry with the error message
            code = clean_code(llm_complete(messages, llm_model, max_tokens=1024, temperature=0.0))
            logger.info("Pandas code (attempt %d): %s", attempt + 1, code)
            try:
                raw = safe_eval(code, df)
                result_str = result_to_text(raw)
                break
            except UnsafeExpression as e:
                logger.warning("Blocked unsafe pandas code: %s | %s", e, code)
                err = f"That expression is not allowed ({e})."
            except Exception as e:
                logger.warning("Exec failed: %s | code: %s", e, code)
                err = f"{type(e).__name__}: {e}"
            messages += [{"role": "assistant", "content": code or "(empty)"},
                         {"role": "user", "content": f"That failed with: {err}\nReply with a corrected single pandas expression only."}]
        chart = fi.build_chart(raw, data_df, _chart_question(question, history), chart_req) if chart_req else None
        if result_str is None and not (metrics or chart):
            return None
        if result_str is None:          # code failed, but exact figures / chart are still available
            result_str = "(see verified key figures" + (" and chart data" if chart else "") + ")"

        answer = llm_complete(
            [
                {"role": "system", "content": "You are FinVision, a financial analyst assistant. Present computed results "
                                              "accurately: use the exact numbers given, never invent figures, and mention "
                                              "the source file(s). Keep it concise (3-6 sentences or a short list). "
                                              + fi.audience_instructions(info)},
                *_history_messages(history),
                {"role": "user", "content": "Files: " + ", ".join(filenames) + "\nQuestion: " + question + "\n\n"
                                            + metrics_block + "\nComputed result for this question:\n" + result_str[:6000] + "\n\n"
                                            + fi.chart_summary(chart)
                                            + ("Refer to the chart briefly (main pattern, highest/lowest) instead of listing every point.\n" if chart else "")
                                            + "Answer:"},
            ],
            llm_model, max_tokens=1024, temperature=0.2,
        ) or f"Here is the computed result:\n{result_str}"

        return {"answer": answer, "citations": citations, "latency_ms": int((time.time() - start) * 1000),
                "chart": chart, "audience": info.get("audience")}
    finally:
        db.close()

EXACT_SEARCH_MAX = 50_000   # chunks; below this, filtered search is done exactly


def _search_chunks(col, q_vec, where, k, total):
    """
    Top-k chunks matching the filter. Chroma's approximate (HNSW) search applies
    the user/file filter AFTER finding nearest neighbours, so once the shared
    collection is large, a small file can return ZERO results even though its
    chunks exist. When that happens we search the user's own chunks exactly.
    """
    res   = col.query(query_embeddings=[q_vec], n_results=min(k, total), where=where,
                      include=["documents", "metadatas", "distances"])
    docs  = res["documents"][0] if res.get("documents") else []
    metas = res["metadatas"][0] if res.get("metadatas") else []
    dists = res["distances"][0] if res.get("distances") else []
    if len(docs) >= k:
        return docs, metas, dists

    ids = col.get(where=where, include=[])["ids"]
    if len(ids) <= len(docs) or len(ids) > EXACT_SEARCH_MAX:
        return docs, metas, dists
    got = col.get(ids=ids, include=["embeddings", "documents", "metadatas"])
    mat = np.asarray(got["embeddings"], dtype=np.float32)
    q   = np.asarray(q_vec, dtype=np.float32)
    sims = mat @ q / ((np.linalg.norm(mat, axis=1) * (np.linalg.norm(q) or 1.0)) + 1e-12)
    order = np.argsort(-sims)[:k]
    logger.info("Exact search fallback: %d candidate chunks (approximate search returned %d)", len(ids), len(docs))
    return ([got["documents"][i] for i in order], [got["metadatas"][i] for i in order],
            [float(1 - sims[i]) for i in order])


# ── RAG Query ─────────────────────────────────────────────────────────────────
def _only_tabular(active_file_ids, user_id):
    from database import SessionLocal
    from models.db_models import UploadedFile
    db = SessionLocal()
    try:
        types = [t for (t,) in db.query(UploadedFile.file_type).filter(
            UploadedFile.id.in_(active_file_ids), UploadedFile.user_id == user_id).all()]
        return bool(types) and all(t.value in ("csv", "xlsx") for t in types)
    finally:
        db.close()


def query_rag(question, user_id, active_file_ids, db_settings, history=None):
    info = fi.classify(question)
    # Numbers, finance terms, everyday money questions and charts → real pandas
    # computation over CSV/XLSX. Spreadsheet-only selections always compute.
    # Falls back to document retrieval for PDFs or if computation fails.
    use_pandas = active_file_ids and (info["needs_numbers"] or is_aggregation_query(question)
                                      or _only_tabular(active_file_ids, user_id))
    restyled = fi.restyle_previous(question, info, history)
    if restyled:
        start = time.time()
        model = db_settings.get("llm_model") or settings.default_llm_model
        answer = llm_complete(
            [{"role": "system", "content": "You are FinVision, a financial analyst assistant. The user asked to see the "
                                          "previous result as a different chart. Briefly describe what the chart shows "
                                          "(2-3 sentences). " + fi.audience_instructions(info)},
             *_history_messages(history),
             {"role": "user", "content": question + "\n\n" + fi.chart_summary(restyled)}],
            model, max_tokens=512, temperature=0.2,
        ) or f"Here is the same data as a {restyled['type']} chart."
        return {"answer": answer, "citations": [], "latency_ms": int((time.time() - start) * 1000),
                "chart": restyled, "audience": info["audience"]}

    if use_pandas:
        logger.info("Computation path | audience=%s chart=%s terms=%s", info["audience"], info["chart"],
                    [t["name"] for t in info["terms"]])
        try:
            result = run_pandas_query(question, active_file_ids, user_id, db_settings, history, info)
        except Exception as e:
            logger.warning("Pandas path failed, using retrieval instead: %s", e)
            result = None
        if result:
            return result

    start      = time.time()
    col        = get_chroma_collection()
    emb        = get_embedder()
    k          = db_settings.get("k_value")     or settings.default_k_value
    temp       = db_settings.get("temperature")
    temp       = settings.default_temperature if temp is None else temp
    max_tok    = db_settings.get("max_tokens")  or settings.default_max_tokens
    model      = db_settings.get("llm_model")   or settings.default_llm_model
    top_p      = db_settings.get("top_p")       or 0.9

    prev_q = next((h.get("content", "") for h in reversed(history or []) if h.get("role") == "user"), "")
    search_text = (prev_q[:300] + "\n" + question) if prev_q and len(question) < 120 else question
    q_vec = emb.encode([search_text], show_progress_bar=False).tolist()[0]

    where = {
        "$and": [
            {"user_id": {"$eq": str(user_id)}},
            {"file_id": {"$in": [str(fid) for fid in active_file_ids]}},
        ]
    } if active_file_ids else {"user_id": {"$eq": str(user_id)}}

    total = col.count()
    if total == 0:
        return {"chart": None, "answer": "No documents are indexed yet. Upload a file and wait until it shows 'Verified & Indexed'.",
                "citations": [], "latency_ms": int((time.time() - start) * 1000)}
    docs, metas, dists = _search_chunks(col, q_vec, where, int(k), total)

    if not docs:
        return {"answer": "I could not find relevant information in the uploaded documents.", "citations": [], "latency_ms": int((time.time()-start)*1000)}

    context_parts, citations, seen = [], [], set()
    for doc, meta, dist in zip(docs, metas, dists):
        fname = meta.get("filename", "Unknown")
        page  = meta.get("page", "N/A")
        rel   = round(max(0.0, min(1.0, 1 - dist)) * 100, 1)
        context_parts.append("[Source: " + fname + ", Page: " + str(page) + "]\n" + doc)
        key = fname + "_" + str(page)
        if key not in seen:
            seen.add(key)
            citations.append({"source": fname, "page": str(page), "snippet": doc[:200] + ("..." if len(doc) > 200 else ""), "relevance": rel})

    context = "\n\n---\n\n".join(context_parts)

    answer = llm_complete(
        [
            {"role": "system", "content": "You are FinVision, an expert financial analyst AI. Answer ONLY using the context. "
                                          "Cite sources. Never fabricate data. Use the earlier conversation only to understand "
                                          "what follow-up questions refer to. " + fi.audience_instructions(info)},
            *_history_messages(history),
            {"role": "user",   "content": "Context:\n" + context + "\n\nQuestion: " + question},
        ],
        model, max_tokens=max_tok, temperature=temp, top_p=top_p,
    ) or "The AI model returned an empty answer. Please try rephrasing the question."
    if info["chart"]:
        answer += ("\n\n_Charts are drawn from spreadsheet data. Activate a CSV or Excel file with the numbers "
                   "you want plotted and ask again._")

    return {
        "answer":     answer,
        "citations":  citations,
        "latency_ms": int((time.time()-start)*1000),
        "chart":      None,
        "audience":   info["audience"],
    }

# ── Preprocessing ─────────────────────────────────────────────────────────────
def preprocess_command(command, file_path, file_type, db_settings=None):
    """Kept for backward compatibility; the real engine is services/preprocess_service.py."""
    from services.preprocess_service import run_preprocess
    return run_preprocess(command, file_path, file_type, db_settings=db_settings)
