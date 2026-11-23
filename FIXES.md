# FinVision — changes

## November 2026 (update 3) — smarter chat, charts in chat, Upload tab, page scroll

### Expert and plain-language questions
- New `backend/services/finance_intel.py` works out who is asking before answering:
  - **Expert** (uses terms like EBITDA, YoY, CAGR, gross/net margin, OpEx, burn rate, run rate, ROI, QoQ…):
    analyst-style answer with precise terms, formulas and exact figures.
  - **Plain language** ("did we make money?", "where does the money go?", "explain simply"):
    everyday words, every finance term explained in brackets, what the result means for them.
  - **General**: direct answer first, short context.
- Before: only questions containing words like "total" or "average" were *calculated*; everything else
  (all finance terms, everyday phrasing, chart requests) went to text search, so margins/growth were guessed
  from a few snippets. Now any question about numbers is calculated over the full spreadsheet, and when only
  CSV/Excel files are selected, every question is.
- Key figures (total revenue, expenses, net profit, profit margin, expense ratio, MoM and YoY growth, CAGR,
  best/worst month, volatility, burn) are computed exactly in pandas and given to the AI, so it never has to
  estimate them. The AI also gets a formula sheet for 30 common finance terms.

### Charts in Analyze & Chat
- Ask "plot revenue over time", "bar chart of expenses by region", "show revenue share as a pie chart",
  "graph monthly sales"… and a chart is drawn under the answer (line, bar, area or pie).
- Each chart has **Chart / Table** views and a **CSV** download. Charts are saved with the chat and come back
  when the conversation is reopened.
- Follow-ups like "show that as a pie chart" redraw the previous chart's data in the new style.
- If the AI's calculation can't be plotted, the chart is still built directly from the data. PDF-only
  questions explain that charts need a CSV/Excel file.
- A `chart` column is added to `chat_messages` automatically on startup (no manual migration).

### Upload tab
- Removed the ERP Integration / External API section (it had no backend). The drop zone now fills the column.

### Page scroll
- On shorter laptop screens the whole page scrolled by 30–110 px on every tab: the sidebar didn't fit and
  stretched the page. The sidebar menu now scrolls inside itself; the page never scrolls (analyst and
  supervisor dashboards). The chat header becomes one compact line on narrow screens so the conversation
  keeps its space.

## November 2026 — chat history + subscriptions

### Chat history (Analyze & Chat)
- New **Chats / Sources** panel on the left: New chat, list of saved conversations grouped by
  Today / Yesterday / Previous 7 days, search, rename (pencil), delete (bin).
- Click a chat to reopen it with all messages and citations. The last open chat is restored when you come back.
- The AI now receives the earlier messages of the conversation, so follow-ups ("and which one is biggest?") work.
- A question that fails is no longer left in the history without an answer.
- New endpoint: `PATCH /chat/sessions/{id}` (rename); `GET /chat/sessions?q=` searches titles and returns
  last activity + preview.

### Subscriptions
- Plans (starting prices, change them any time from **Supervisor → Plans & Pricing**):

  | Plan | Monthly | Yearly | Uploads | AI questions | Forecasts | Reports | Max file |
  |---|---|---|---|---|---|---|---|
  | Free | $0 | $0 | 10 | 50 | 5 | 2 | 10 MB |
  | Pro | $19 | $190 | 100 | 1,000 | 50 | 30 | 50 MB |
  | Business | $49 | $490 | unlimited | unlimited | unlimited | unlimited | 100 MB |

- Limits are per calendar month and reset on the 1st. Usage is counted separately, so deleting chats or files
  doesn't reset it. Supervisors are never limited. Existing users start on Free automatically.
- Analyst: new **Plans & Billing** page (current plan, usage meters, monthly/yearly toggle, upgrade, cancel /
  keep plan, billing history), plan badge in the sidebar, and a banner with **View plans** when a limit is hit.
- Supervisor: **Plans & Pricing** page to edit names, prices, currency (e.g. PKR), limits, features, visibility,
  "Most popular", and add new plans; shows paying subscribers, MRR and revenue this month.
- Payments run in **demo mode** (`PAYMENT_PROVIDER=demo`): plans activate instantly, no card is charged, and a
  demo invoice is recorded. To take real payments, implement `_charge()` in `backend/services/billing_service.py`.
- New tables are created automatically on startup (`subscription_plans`, `subscriptions`, `payments`,
  `usage_counters`). No manual migration.

### Also fixed
- Chat search could return **no results** for small files once the database held many documents (Chroma's
  filtered approximate search). It now falls back to an exact search over the user's own chunks.

---

# Bug fixes (October 2026)

Tested end to end with PostgreSQL 16, FastAPI, ChromaDB, Prophet and a real
headless Chromium browser. 45 preprocessing-engine checks, 88 API checks
(tabs 1–5) and 24 browser checks pass.

## Setup after pulling

```bash
cd backend
pip install -r requirements.txt     # adds bcrypt + email-validator
uvicorn main:app --reload --port 8000
```
No database migration is needed. Existing accounts keep working.

## Fresh-install blockers
| Problem | Fix |
|---|---|
| Backend would not start on SQLAlchemy 2.1 (`No module named 'psycopg'`) | `database.py` pins the `psycopg2` driver |
| `/auth/register` crashed: `email-validator is not installed` | added to `requirements.txt` |
| Register/login crashed with bcrypt 5 (`password cannot be longer than 72 bytes`) | `auth.py` uses `bcrypt` directly (same hash format) |
| `.env.example` had `GROQ_API_KEY=GROQ_API_KEY=...` | fixed |

## Tab 1 — Upload Data
- Every upload stuck on "Processing": background indexing made a new DB engine from the raw URL (driver bug + connection leak). Now reuses the app's pool.
- CSVs saved from Excel on Windows (cp1252, e.g. "Café") failed to index everywhere. New `services/file_utils.read_csv_any`.
- File names like `../../main.py` were written outside the uploads folder. Names are now sanitised.
- Empty files accepted; delete had no confirmation; failed files showed no reason; dropping files during an upload started a second batch.

## Tab 2 — Preprocess (rewritten: `services/preprocess_service.py`)
- **Every command failed** with `Expecting value: line 1 column 1 (char 0)`: gpt-oss is a reasoning model and `max_tokens=200` left its reply empty; the reply was also parsed with a bare `json.loads`.
- **Silent data corruption:** `df.fillna(0)` ran before every command, so "fill with mean" wrote 0, text gaps became `"0"`, and the AI was told there were no missing values.
- "Normalize revenue" did nothing (column is `Revenue`) but reported success; quick actions "Drop rows with null values" and "Add profit margin column" weren't supported at all.
- Excel files lost every sheet except the first.
- File switched to "processing" after each command, vanished from the list, and stayed stuck if re-indexing failed.
- Common commands now run instantly through a rule-based parser (no LLM): duplicates, fill (value/mean/median/mode/forward/backward/interpolate), drop null rows, drop/rename columns, normalize/standardize, profit margin, formula columns (`add column Profit = Revenue - Expense`), type conversion, row filters, sort, round, trim/case, outliers, replace values, and "show missing values"/"summary". Steps can be chained with "and". Anything else goes to the LLM with JSON mode and a validated plan.
- Unknown columns now give a clear error listing real columns; nothing is written.
- New: Undo (last 10 changes), Download cleaned file, sheet picker for Excel, live rows/columns/missing/duplicates stats, preview on open.

## Tab 3 — Analyze & Chat
- **Security:** LLM-written pandas code ran via `eval()` with full builtins (could run shell commands). Now AST-validated in `services/safe_eval.py`.
- Same empty-reply problem as Preprocess (`max_tokens` 200/400); now retries and falls back.
- Questions containing "summary", "show me", "what are"… about PDFs failed with "Could not load files." They now fall back to document retrieval.
- `fillna(0)` corrupted text and crashed on pandas 3; Excel questions only looked at sheet 1 (now picks the matching sheet).
- XSS: chat rendered raw HTML from user/LLM text (also fixed in Preprocess).

## Tab 4 — Forecast
- `detect_metric_column` referenced an undefined variable (`NameError`).
- Files without a date column used "Revenue" as the date; missing dates became 1970-01-01; missing values became fake zero months.
- Metrics such as "Paid Amount", "Growth" were hidden (substring match on "id"/"row").
- YoY growth divided by zero → HTTP 500; it also compared with 11 months back instead of 12.
- Profit/loss forecasts were clipped to 0.
- Changing the Excel sheet didn't reload its metrics; the "Now" line was drawn at the first month; the y-axis cut off negative values; small gap between actual and forecast lines.

## Tab 5 — My Reports
- PDF reports were never created (imported `PyPDF2`, which isn't installed). Text like "R&D" or "<5%" would also have crashed ReportLab.

## Not changed
- The "Connect Integration" (ERP/API) button in the Upload tab is still a placeholder with no backend.
