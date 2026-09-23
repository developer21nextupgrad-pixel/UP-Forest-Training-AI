# UP Forest Training Platform — Production-Oriented Run Instructions

## Prerequisites
- Python 3.12+
- Node.js 22+ and npm
- Docker Desktop (recommended for PostgreSQL/pgvector + Redis)
- Mistral API key for OCR, embeddings and Tutor/quiz generation

## 1. Start PostgreSQL + pgvector and Redis
From PowerShell at the project root:
```powershell
docker compose up -d db redis
```

## 2. Configure backend
```powershell
Copy-Item backend\.env.example backend\.env
```
Set `MISTRAL_API_KEY` and a strong `JWT_SECRET_KEY`. Keep `.env` private.

For local development the default database is `postgresql+asyncpg://postgres:postgres@localhost:5432/up_forest`, Redis is `redis://localhost:6379/0`, and `VECTOR_STORE=pgvector`.

## 3. Install backend
```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install -e ".[dev]"
```

## 4. Run migrations
```powershell
alembic upgrade head
```
The latest migration enables the PostgreSQL `vector` extension and creates the production content/provenance/job schema.

## 5. Optional demo seed
Demo seed data is development-only and is not required by production ingestion. If you need local demo users, set `ADMIN_PASSWORD`, `INSTRUCTOR_PASSWORD`, and `STUDENT_PASSWORD`, then run:
```powershell
python -m app.db.seed
```
Do not use demo RAG files as production knowledge.

## 6. Start backend
```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 7. Start worker
In another PowerShell window:
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m app.worker
```

## 8. Install/start frontend
```powershell
cd frontend
npm install
npm run dev
```
Open http://localhost:3000.

## 9. Tests/checks
Backend:
```powershell
cd backend
python -m compileall app tests
pytest
ruff check app tests
```
Frontend:
```powershell
cd frontend
npm run lint
npx tsc --noEmit
npm run build
```

## 10. Ingest the official Forest PDF
1. Log in as ADMIN.
2. Create/select the appropriate Forest Department subject.
3. Create a book.
4. Upload the official scanned PDF from the conversation/source package.
5. Monitor the ingestion job.
6. Wait for `READY` before expecting student/RAG content.

The supplied reference PDF contains 496 physical PDF pages and its final scanned page is printed page 492. The application therefore records physical PDF page numbers separately from printed page numbers when OCR exposes a reliable printed footer number. It does not invent missing chapters/pages.

## 11. Reprocessing/versioning
Reprocessing creates a new `DocumentVersion`. The old current version stays current until the new version completes successfully. Failed/partial versions remain non-current.

## 12. Troubleshooting
- **`vector` extension missing:** use `pgvector/pgvector:pg16` or install pgvector in your PostgreSQL server, then rerun `alembic upgrade head`.
- **Mistral 429:** the app applies bounded concurrency, Retry-After, exponential backoff and jitter. Check worker/API logs.
- **No chapters:** verify OCR quality and that the source actually contains explicit chapter markers; the system intentionally avoids inventing chapters.
- **No RAG results:** verify the document version is `READY`, embeddings are populated, and `VECTOR_STORE=pgvector`.
- **Docker frontend build cannot download dependencies:** run frontend locally with `npm install` and `npm run dev`, or retry when network access is available.
