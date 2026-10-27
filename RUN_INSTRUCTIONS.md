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
npm test
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

## 12. Offline Field Officer Forms

Daily Diary, Patrol Reports, Incident Reports, and Offence & Seizure drafts are persisted in account-scoped browser IndexedDB. Their explicit Save and Submit actions can be queued when the API or database cannot be reached; queued submissions remain pending until the existing server validation and authorization succeeds. Stable client operation IDs prevent duplicate creates and Offence & Seizure evidence uploads when an acknowledgement is lost. Draft updates and user-requested submissions use the existing endpoints. The API remains responsible for validation, ownership checks, and authorization.

Species Identification stores the selected image locally and can queue an identification the officer explicitly requested while offline. That AI request runs only after the API becomes reachable; image inference and AI extraction are not performed locally. AI Field Assistant chat, speech/voice processing, and AI extraction still require their existing online services.

Apply migrations before starting sync after updating the backend:
```powershell
cd .\backend
.\venv\Scripts\python.exe -m alembic upgrade head
```

Queues sync when the API and database become reachable, when the page returns to the foreground, and on a visible-page retry interval. Connectivity checks use the API health endpoint rather than relying on `navigator.onLine` alone. The report forms display connection/sync state, a pending-operation count, and **Sync Now**; Species Identification displays connection and pending state with **Retry Identification**. A queued operation is not removed until the server confirms success. Authentication changes pause syncing; unsynced data stays partitioned to the original Field Officer account. Failed validation/conflict operations and their form data remain on-device for correction/retry.

The browser must remain open in a visible/reopened tab for retry. Background sync after every tab is closed is not guaranteed: no service worker/background-sync mechanism was added. Browser IndexedDB is not encrypted by this application; use a trusted device. Offence evidence uploads can be queued with the draft. Evidence deletion, viewing remote evidence files, and existing saved-report retrieval require a reachable API.

Manual check:
1. Sign in as a Field Officer and open each form while the API is reachable. Enter draft data, refresh, and verify the active editor is restored.
2. Disconnect from the API/network and save/update a Patrol, Incident, and Offence & Seizure draft. Confirm each remains in the editor with pending state/count.
3. With an Offence & Seizure draft queued, select an allowed evidence file and queue its upload.
4. Click Submit while offline only when you intend to submit. Verify the record remains visibly pending rather than being presented as submitted.
5. In Species Identification, select an image and click Identify offline. Confirm the image and pending identification survive refresh.
6. Reconnect the API/database, keep the page open or return it to the foreground, and wait for automatic sync or select **Sync Now**.
7. Confirm each report/evidence file is present only once, pending counts clear, and submitted records appear submitted only after server validation.
8. Sign in as a different Field Officer in the same browser profile. Confirm cached drafts are not displayed or transmitted under the other account; switch back to sync the original account's retained queue.

## 13. WhatsApp Assistant

The backend currently supports Meta webhook verification and receive-only event acknowledgement. Set `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` in the Render service environment (or `backend/.env` locally). These values are not committed. No access token, database migration, or outbound messaging credential is required for webhook verification and acknowledgement.

Configure the Meta callback URL as `https://up-forest-training-ai.onrender.com/api/v1/whatsapp/webhook`, enter the same `WHATSAPP_VERIFY_TOKEN` in Meta, and subscribe to the `messages` field. `GET /api/v1/whatsapp/webhook` returns the challenge only for a matching subscription verification token. `POST` verifies the HMAC signature over the exact request bytes, validates the event envelope, and logs only event type/count metadata. It does not store or inspect message content, pair accounts, call AI, or send messages. Configure the environment variables in Render and trigger a normal deploy/redeploy; no production environment values are changed by this code.

## 14. Troubleshooting
- **`vector` extension missing:** use `pgvector/pgvector:pg16` or install pgvector in your PostgreSQL server, then rerun `alembic upgrade head`.
- **Mistral 429:** the app applies bounded concurrency, Retry-After, exponential backoff and jitter. Check worker/API logs.
- **No chapters:** verify OCR quality and that the source actually contains explicit chapter markers; the system intentionally avoids inventing chapters.
- **No RAG results:** verify the document version is `READY`, embeddings are populated, and `VECTOR_STORE=pgvector`.
- **Docker frontend build cannot download dependencies:** run frontend locally with `npm install` and `npm run dev`, or retry when network access is available.
