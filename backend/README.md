# FinVision Backend — Setup Guide

## Prerequisites
- Python 3.11+
- PostgreSQL installed and running
- A free Groq API key from https://console.groq.com

---

## Step 1: Create PostgreSQL Database

Open pgAdmin or psql and run:

```sql
CREATE DATABASE finvision;
```

---

## Step 2: Set Up Python Environment

```bash
cd finvision/backend

# Create virtual environment
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

---

## Step 3: Configure Environment Variables

```bash
# Copy the example file
cp .env.example .env
```

Now open `.env` and fill in:
- `DATABASE_URL` — your PostgreSQL connection string
- `GROQ_API_KEY` — your key from console.groq.com
- `JWT_SECRET_KEY` — generate one with:
  ```bash
  python -c "import secrets; print(secrets.token_hex(32))"
  ```

Example `.env`:
```
DATABASE_URL=postgresql://postgres:mypassword@localhost:5432/finvision
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
JWT_SECRET_KEY=a3f9c2e1b4d8f7a6c5e2d1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1
```

---

## Step 4: Run the Backend

```bash
uvicorn main:app --reload --port 8000
```

You should see:
```
🚀 Starting FinVision Backend
✅ Database: PostgreSQL connected
📖 API Docs: http://localhost:8000/docs
```

---

## Step 5: Test It's Working

Open your browser:
- http://localhost:8000/health     → should return {"status": "healthy"}
- http://localhost:8000/docs       → Swagger UI with all endpoints

---

## Step 6: Run the Frontend

```bash
cd finvision/frontend
pnpm install   (or npm install)
pnpm dev       (or npm run dev)
```

Frontend runs at: http://localhost:5173

---

## Phase 1 Endpoints Available

| Method | Endpoint              | Description           |
|--------|-----------------------|-----------------------|
| GET    | /health               | System health check   |
| POST   | /auth/register        | Create account        |
| POST   | /auth/login           | Get JWT token         |
| GET    | /auth/me              | Current user info     |
| POST   | /upload/file          | Upload CSV/XLSX/PDF   |
| GET    | /upload/files         | List user's files     |
| PATCH  | /upload/files/{id}/toggle | Toggle AI context |
| DELETE | /upload/files/{id}    | Delete file           |

---

## Folder Structure

```
backend/
├── main.py              ← FastAPI app entry point
├── config.py            ← Settings from .env
├── database.py          ← PostgreSQL connection
├── requirements.txt
├── .env                 ← Your config (never commit this)
├── .env.example         ← Template (safe to commit)
├── models/
│   ├── __init__.py
│   └── db_models.py     ← All database table definitions
├── routers/
│   ├── __init__.py
│   ├── auth.py          ← Register, login, logout
│   └── upload.py        ← File upload and management
└── services/            ← Business logic (Phase 2+)
    └── __init__.py
```

---

## Coming in Phase 2
- `services/rag_service.py` — ChromaDB ingestion + querying
- `routers/chat.py` — RAG chat with citations
- Real file parsing (PDF, XLSX, CSV)
