# Getting Started

Personal COROS performance analytics — self-hosted, single-user.

## Prerequisites

| Tool | Minimum version | Install |
|---|---|---|
| Docker + Docker Compose | 24+ | [docs.docker.com](https://docs.docker.com/get-docker/) |
| Python | 3.12+ | [python.org](https://www.python.org/downloads/) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| `uv` (Python package manager) | any | `pip install uv` |

> [!NOTE]
> The project uses **uv** for the backend and **npm** for the frontend. Both are required.

---

## 1. Clone the repo

```bash
git clone https://github.com/your-username/coros.git
cd coros
```

---

## 2. Configure your environment

```bash
cp .env.example .env
```

Open `.env` and fill in **at minimum** these values:

```env
# Who you are — determines your stable user ID automatically
OWNER_EMAIL=your@email.com
OWNER_TIMEZONE=Asia/Bangkok   # your local timezone
OWNER_UNITS=metric            # metric | imperial
```

Everything else has working defaults for local development.

> [!IMPORTANT]
> Never commit `.env` — it is already in `.gitignore`.

---

## 3. Start infrastructure (PostgreSQL + Redis)

```bash
docker compose up -d
```

Verify both containers are healthy:

```bash
docker compose ps
```

Expected output:

```
NAME            STATUS
coros-db-1      Up (healthy)
coros-redis-1   Up (healthy)
```

---

## 4. Install and start the backend

```bash
cd backend

# Install dependencies into a virtual environment
uv sync

# Start the dev server (auto-reloads on file changes)
uv run uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
```

> [!NOTE]
> On first startup, the server automatically:
> - Creates all database tables
> - Seeds your owner user row (derived from `OWNER_EMAIL`)
>
> No migrations to run manually.

Verify it started:

```bash
curl http://localhost:8000/api/health
# → {"status":"ok"}
```

---

## 5. Install and start the frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 6. Configure COROS Account in UI

Navigate to **Settings** in the Web UI and enter your COROS account email and password. Your credentials will be encrypted with AES-256-GCM and stored securely in the database. You are now ready to sync!

Set one of the following in `.env`:

**Option A — Gemini:**
```env
GEMINI_ENABLED=true
GEMINI_API_KEY=your_api_key
GEMINI_MODEL=gemini-2.5-flash
```

**Option B — Any OpenAI-compatible server (Ollama, LM Studio, vLLM, etc.):**
```env
OPENAI_COMPAT_ENABLED=true
OPENAI_COMPAT_BASE_URL=http://localhost:11434/v1
OPENAI_COMPAT_API_KEY=ollama
OPENAI_COMPAT_MODEL=llama3
```

Restart the backend after changing `.env`.

---

## Daily workflow

```bash
# Start infrastructure (if not already running)
docker compose up -d

# Terminal 1 — backend
cd backend && uv run uvicorn src.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

---

## Stop everything

```bash
# Stop infrastructure (data is persisted in a named Docker volume)
docker compose down

# To also wipe all data
docker compose down -v
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Connection refused` on port 5432 | `docker compose up -d` — Postgres is not running |
| `ForeignKeyViolationError` on sync | Check `OWNER_EMAIL` in `.env`, then restart the backend |
| Backend says `Address already in use` | Another process owns port 8000: `lsof -ti:8000 \| xargs kill` |
| Frontend cannot reach backend | Confirm backend is on port 8000 and running |
