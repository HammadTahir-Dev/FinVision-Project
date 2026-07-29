"""
rag_service.py — Complete RAG pipeline with file-aware routing.
Handles: single file, multi-file same schema, multi-file different schema.
Supports 10-15 active files with intelligent query routing.
"""
import os, logging, time, json
import pandas as pd
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
    df = pd.read_csv(path).fillna("")
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
            df = pd.read_csv(file_path, nrows=2)
        elif file_type == "xlsx":
            df = pd.read_excel(file_path, nrows=2)
        else:
            return []
        return [c.lower().strip() for c in df.columns]
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

def _load_files(file_records, mode):
    dfs, names = [], []
    for fr in file_records:
        try:
            ft = fr.file_type.value
            if ft == "csv":
                df = pd.read_csv(fr.file_path)
            elif ft == "xlsx":
                df = pd.read_excel(fr.file_path)
            else:
                continue
            df["__source__"] = fr.original_name
            dfs.append(df.fillna(0))
            names.append(fr.original_name)
        except Exception as e:
            logger.warning("Load failed '%s': %s", fr.original_name, e)

    if not dfs:
        return pd.DataFrame(), []
    if len(dfs) == 1:
        return dfs[0], names

    try:
        merged = pd.concat(dfs, ignore_index=True, sort=False).fillna(0)
        return merged, names
    except Exception:
        return dfs[0], [names[0]]

def _build_schema(df, filenames):
    cols = [c for c in df.columns if c != "__source__"]
    lines = []
    for c in cols:
        try:
            sample = str(df[c].dropna().iloc[0])[:40] if len(df[c].dropna()) > 0 else "N/A"
        except Exception:
            sample = "N/A"
        lines.append("  - " + c + " (" + str(df[c].dtype) + ") e.g. '" + sample + "'")

    cat_lines = []
    for c in df.select_dtypes(include=["object"]).columns:
        if c == "__source__":
            continue
        try:
            uniq = str(df[c].dropna().unique()[:5].tolist())
            cat_lines.append("  - " + c + ": " + uniq)
        except Exception:
            pass

    src = ""
    if len(filenames) > 1:
        src = "\nMerged files (" + str(len(filenames)) + "): " + ", ".join(filenames) + "\n__source__ column = filename per row\n"

    result = "Shape: " + str(len(df)) + " rows x " + str(len(cols)) + " cols" + src + "\nColumns:\n" + "\n".join(lines)
    if cat_lines:
        result += "\nCategorical:\n" + "\n".join(cat_lines)
    return result

# ── Pandas Query Engine ───────────────────────────────────────────────────────
PANDAS_PROMPT = """You are a Python/pandas expert for financial data analysis.
Write ONE pandas expression that completely answers the question.

RULES:
1. Return ONLY the expression — no markdown, no explanation
2. Dataframe is `df`. Column `__source__` = filename of each row
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
10. NEVER use os, sys, or any module other than df and pd.
    NEVER access file paths or file sizes — only query the dataframe df."""

def is_aggregation_query(question):
    q = question.lower()
    return any(kw in q for kw in AGGREGATION_KEYWORDS)

def run_pandas_query(question, active_file_ids, user_id, db_settings):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from models.db_models import UploadedFile

    engine    = create_engine(settings.database_url)
    Session   = sessionmaker(bind=engine)
    db        = Session()
    groq      = get_groq_client()
    llm_model = db_settings.get("llm_model", settings.default_llm_model)
    start     = time.time()

    try:
        records = db.query(UploadedFile).filter(
            UploadedFile.id.in_(active_file_ids),
            UploadedFile.user_id == user_id,
        ).all()

        if not records:
            return {"answer": "No active files found.", "citations": [], "latency_ms": 0}

        # Route to relevant files
        selected, mode = _route_files(question, records)
        logger.info("Route mode: %s | Files: %s", mode, [f.original_name for f in selected])

        # Load and merge
        df, filenames = _load_files(selected, mode)
        if df.empty:
            return {"answer": "Could not load files.", "citations": [], "latency_ms": 0}

        schema = _build_schema(df, filenames)

        citations = []
        for name in filenames:
            row_count = len(df[df["__source__"] == name]) if "__source__" in df.columns else len(df)
            citations.append({"source": name, "page": "Full dataset", "snippet": str(row_count) + " rows analyzed", "relevance": 100.0})

        # Generate pandas code
        code_resp = groq.chat.completions.create(
            model=llm_model,
            messages=[
                {"role": "system", "content": PANDAS_PROMPT},
                {"role": "user",   "content": "Schema:\n" + schema + "\n\nQuestion: " + question + "\n\nPandas expression:"},
            ],
            temperature=0.0, max_tokens=200,
        )
        code = code_resp.choices[0].message.content.strip().replace("```python","").replace("```","").strip()
        logger.info("Pandas code: %s", code)

        # Execute
        try:
            result = eval(code, {"df": df, "pd": pd})
            result_str = str(result)
        except Exception as e:
            logger.warning("Exec failed: %s | code: %s", e, code)
            result_str = "Error: " + str(e)

        # Format answer
        final = groq.chat.completions.create(
            model=llm_model,
            messages=[
                {"role": "system", "content": "You are a senior financial analyst. Present computed results clearly. Mention exact numbers and source files. Keep it concise (3-5 sentences)."},
                {"role": "user",   "content": "Files: " + ", ".join(filenames) + "\nQuestion: " + question + "\nResult:\n" + result_str + "\n\nPresent professionally:"},
            ],
            temperature=0.2, max_tokens=400,
        )
        return {
            "answer":     final.choices[0].message.content,
            "citations":  citations,
            "latency_ms": int((time.time()-start)*1000),
        }
    finally:
        db.close()

# ── RAG Query ─────────────────────────────────────────────────────────────────
def query_rag(question, user_id, active_file_ids, db_settings):
    # Route aggregation to pandas
    if is_aggregation_query(question) and active_file_ids:
        logger.info("Aggregation → pandas handler")
        return run_pandas_query(question, active_file_ids, user_id, db_settings)

    start      = time.time()
    col        = get_chroma_collection()
    emb        = get_embedder()
    groq       = get_groq_client()
    k          = db_settings.get("k_value",    settings.default_k_value)
    temp       = db_settings.get("temperature", settings.default_temperature)
    max_tok    = db_settings.get("max_tokens",  settings.default_max_tokens)
    model      = db_settings.get("llm_model",   settings.default_llm_model)
    top_p      = db_settings.get("top_p",       0.9)

    q_vec = emb.encode([question], show_progress_bar=False).tolist()[0]

    where = {
        "$and": [
            {"user_id": {"$eq": str(user_id)}},
            {"file_id": {"$in": [str(fid) for fid in active_file_ids]}},
        ]
    } if active_file_ids else {"user_id": {"$eq": str(user_id)}}

    res   = col.query(query_embeddings=[q_vec], n_results=min(k, col.count() or 1), where=where, include=["documents","metadatas","distances"])
    docs  = res["documents"][0] if res["documents"] else []
    metas = res["metadatas"][0] if res["metadatas"] else []
    dists = res["distances"][0]  if res["distances"] else []

    if not docs:
        return {"answer": "I could not find relevant information in the uploaded documents.", "citations": [], "latency_ms": int((time.time()-start)*1000)}

    context_parts, citations, seen = [], [], set()
    for doc, meta, dist in zip(docs, metas, dists):
        fname = meta.get("filename", "Unknown")
        page  = meta.get("page", "N/A")
        rel   = round((1-dist)*100, 1)
        context_parts.append("[Source: " + fname + ", Page: " + str(page) + "]\n" + doc)
        key = fname + "_" + str(page)
        if key not in seen:
            seen.add(key)
            citations.append({"source": fname, "page": str(page), "snippet": doc[:200] + ("..." if len(doc)>200 else ""), "relevance": rel})

    context = "\n\n---\n\n".join(context_parts)

    resp = groq.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are FinVision, an expert financial analyst AI. Answer ONLY using the context. Cite sources. Never fabricate data."},
            {"role": "user",   "content": "Context:\n" + context + "\n\nQuestion: " + question},
        ],
        temperature=temp, max_tokens=max_tok, top_p=top_p,
    )

    return {
        "answer":     resp.choices[0].message.content,
        "citations":  citations,
        "latency_ms": int((time.time()-start)*1000),
    }

# ── Preprocessing ─────────────────────────────────────────────────────────────
def preprocess_command(command, file_path, file_type):
    groq = get_groq_client()
    if file_type == "csv":
        df = pd.read_csv(file_path)
    elif file_type == "xlsx":
        df = pd.read_excel(file_path)
    else:
        return {"error": "Only CSV and XLSX supported."}

    df = df.fillna(0)
    before_shape = df.shape
    before_nulls = df.isnull().sum().to_dict()
    df_info = "Columns: " + str(df.columns.tolist()) + "\nShape: " + str(df.shape) + "\nNulls: " + str(before_nulls)

    resp = groq.chat.completions.create(
        model=settings.default_llm_model,
        messages=[
            {"role": "system", "content": 'You are a pandas expert. Respond ONLY with JSON: {"operation":"remove_duplicates|fill_nulls|normalize|drop_column|convert_types","params":{},"description":"what was done"}'},
            {"role": "user",   "content": df_info + "\n\nCommand: " + command},
        ],
        temperature=0.0, max_tokens=200,
    )

    try:
        instr  = json.loads(resp.choices[0].message.content)
        op     = instr.get("operation","")
        params = instr.get("params", {})
        desc   = instr.get("description","Operation completed")

        if op == "remove_duplicates":
            df = df.drop_duplicates()
        elif op == "fill_nulls":
            method = params.get("method","value")
            val    = params.get("value",0)
            if method == "mean":
                df = df.fillna(df.mean(numeric_only=True))
            elif method == "forward":
                df = df.ffill()
            else:
                df = df.fillna(val)
        elif op == "normalize":
            col = params.get("column")
            if col and col in df.columns:
                df[col] = (df[col]-df[col].min())/(df[col].max()-df[col].min())
        elif op == "drop_column":
            col = params.get("column")
            if col and col in df.columns:
                df = df.drop(columns=[col])
        elif op == "convert_types":
            col   = params.get("column")
            dtype = params.get("dtype","float")
            if col and col in df.columns:
                df[col] = df[col].astype(dtype, errors="ignore")

        if file_type == "csv":
            df.to_csv(file_path, index=False)
        else:
            df.to_excel(file_path, index=False)

        return {
            "success":      True,
            "description":  desc,
            "operation":    op,
            "before_shape": list(before_shape),
            "after_shape":  list(df.shape),
            "before_nulls": before_nulls,
            "after_nulls":  df.isnull().sum().to_dict(),
            "preview":      df.head(5).to_dict(orient="records"),
        }
    except Exception as e:
        logger.error("Preprocessing error: %s", e)
        return {"success": False, "error": str(e)}