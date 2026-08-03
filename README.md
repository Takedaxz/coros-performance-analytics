# COROS Core

> Self-hosted personal health and athletic performance analytics for COROS smartwatch users.

COROS Core ingests data from your COROS watch via the official API, computes advanced training metrics, and provides an AI coach for natural-language training analysis — all running on your own infrastructure with PostgreSQL and Redis.

<p align="center">
  <img src="README/hero.png" alt="COROS Core Dashboard" width="100%" />
</p>

---

<p align="center">
  <img src="https://img.shields.io/badge/python-3.12+-blue.svg" alt="Python">
  <img src="https://img.shields.io/badge/fastapi-0.115+-teal.svg" alt="FastAPI">
  <img src="https://img.shields.io/badge/next.js-16-black.svg" alt="Next.js">
  <img src="https://img.shields.io/badge/react-19-61dafb.svg" alt="React">
  <img src="https://img.shields.io/badge/postgresql-16-336791.svg" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/redis-7-dc382d.svg" alt="Redis">
</p>

---

## Features

### Data Ingestion
- **COROS API Sync** — Real-time data pull via authenticated COROS team and mobile APIs (AES-encrypted)
- **SHA-256 deduplication** — Every record is hash-checked to prevent double-imports
- **SSE progress streaming** — Live sync progress with stage-by-stage updates

### Analytics & Metrics
| Category | Computed Metrics |
|---|---|
| Training Load | ACWR (Acute:Chronic Workload Ratio), Monotony, Strain, Ramp Rate |
| Efficiency | Efficiency Factor, Cardiac Drift, HR Zone Distribution |
| Recovery | Readiness Score, Recovery Score, HRV 7/30-day SMA, HRV Z-scores |
| Fitness | VO2max trend, Running Fitness Index, Lactate Threshold, Biological Age |
| Performance | Race Time Prediction (5K/10K/Half/Marathon), Pace Zones (Daniels & Friel) |
| Anomaly | Z-score and IQR outlier detection on HRV, RHR, and training load |

### AI Coach
- **Multi-Provider AI** — Support for both **Google Gemini Direct** and **OpenAI-Compatible Gateways** (e.g. KKU OKMD, vLLM, Ollama, LM Studio) simultaneously with provider-grouped model selection in the UI
- **Chat & Sessions** — Persistent chat sessions with auto-titling, pinning, title editing, model switching, Markdown export, and PDF printing
- **Weekly Briefing** — Auto-generated summary of last week's training load, recovery, and progress toward goals
- **Workout Postmortem** — Per-activity AI analysis with detailed lap/kilometer split context from recent training and recovery data

### Dashboard & Visualization
- Readiness, HRV, RHR, Sleep, Strain, and Training Load summary cards
- HRV trends with 7-day SMA, Sleep stage breakdowns, Recovery trend charts
- ACWR danger zone detection with Sweet Spot / Overreaching / Danger Zone indicators
- 6-week and 6-month trend charts (Recharts)
- Personal Records trophy cabinet

### Training Plan Integration
- iCal feed ingestion from published calendar (iCloud)
- Auto-classification of events (Run, Strength, Swim, Yoga, Pilates, Race)
- Today's plan, upcoming and past event timeline with configurable date windows

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Next.js 16 SPA                         │
│  Dashboard  Activities  Trends  Sleep  Fitness  Plan  AI      │
│                     Recharts  React-Markdown                   │
└─────────────────────────────┬────────────────────────────────┘
                              │ HTTP / SSE
┌─────────────────────────────▼────────────────────────────────┐
│                     FastAPI (Python 3.12)                      │
│  /api/dashboard  /api/activities  /api/ai  /api/sync          │
│  /api/settings   /api/training-plan                           │
└───────┬──────────────────────┬────────────────┬──────────────┘
        │                      │                │
┌───────▼──────┐   ┌───────────▼──────────┐   ┌─▼──────────────┐
│  PostgreSQL  │   │    COROS API Client   │   │ Multi-Provider │
│   (asyncpg)  │   │  (team + mobile API)  │   │   AI Dispatch  │
└──────────────┘   └───────┬───────────────┘   └┬─────────────┬─┘
        │                                       │             │
┌───────▼──────┐                       ┌────────▼─────┐ ┌─────▼──────┐
│  Redis       │                       │  OpenAI-     │ │  Google    │
│  (token      │                       │  Compatible  │ │  Gemini    │
│   cache)     │                       │  (OKMD, etc) │ │  Direct    │
└──────────────┘                       └──────────────┘ └────────────┘
```

**Data provenance** is tracked on every record — vendor-provided metrics (`*_vendor` fields) are never overwritten by app-derived computations (`*_app` fields). Every record carries `source_type`, `source_hash`, and `parser_version`.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 16, React 19, TypeScript 5 | SPA with App Router |
| Charts | Recharts 3.8 | Area, Bar, Line charts |
| Backend | FastAPI 0.115+, Python 3.12+ | REST + SSE API |
| ORM | SQLAlchemy 2.0 (async) + asyncpg | PostgreSQL access |
| Migrations | Alembic | Schema versioning |
| Job Queue | ARQ (Redis-backed) | Background parsing |
| Cache | Redis 7 | COROS API token cache |
| AI | google-genai, openai | Multi-provider AI (Gemini Direct & OpenAI-compat API) |
| Encryption | PyCryptodome | COROS mobile API AES encryption |
| Logging | structlog | Structured KV logging |
| Lint/Type | ruff, mypy (strict) | Code quality |

---

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 20+
- Docker & Docker Compose

### 1. Clone and set up infrastructure

```bash
git clone https://github.com/<your-org>/coros-core.git
cd coros-core
```p-derived computations (`*_app` fields). Every record carries `source_type`, `source_hash`, and `parser_version`.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 16, React 19, TypeScript 5 | SPA with App Router |
| Charts | Recharts 3.8 | Area, Bar, Line charts |
| Backend | FastAPI 0.115+, Python 3.12+ | REST + SSE API |
| ORM | SQLAlchemy 2.0 (async) + asyncpg | PostgreSQL access |
| Migrations | Alembic | Schema versioning |
| Job Queue | ARQ (Redis-backed) | Background parsing |
| Cache | Redis 7 | COROS API token cache |
| AI | google-genai, openai | Multi-provider AI (Gemini Direct & OpenAI-compat API) |
| Encryption | PyCryptodome | COROS mobile API AES encryption |
| Logging | structlog | Structured KV logging |
| Lint/Type | ruff, mypy (strict) | Code quality |

---

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 20+
- Docker & Docker Compose

### 1. Clone and set up infrastructure

```bash
git clone https://github.com/<your-org>/coros-analytics.git
cd coros-analytics

# Start PostgreSQL and Redis
docker compose up -d
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your COROS credentials and AI API key
```

### 3. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Run migrations
alembic upgrade head

# Start API server (http://localhost:8000)
uvicorn src.main:app --reload
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

### 5. Initial data sync

Click **Sync Now** in the sidebar, or call:

```bash
curl -X POST http://localhost:8000/api/sync/now
```

Track progress via the SSE stream or the UI progress indicator.

---

## Configuration

All settings are in `.env` (copy from `.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgresql+asyncpg://...` | PostgreSQL connection string |
| `REDIS_URL` | Yes | `redis://localhost:6379/0` | Redis connection |
| `COROS_EMAIL` | For sync | — | COROS account email |
| `COROS_PASSWORD` | For sync | — | COROS account password |
| `GEMINI_API_KEY` | Optional | — | Google Gemini API key (enables Gemini Direct models) |
| `GEMINI_MODEL` | No | `gemini-3.5-flash` | Default Gemini model ID |
| `OPENAI_COMPAT_API_KEY` | Optional | — | OpenAI-compatible API key (enables OpenAI-compatible gateway models) |
| `OPENAI_COMPAT_BASE_URL` | Optional | `https://gen.ai.kku.ac.th/okmd/api/v1` | OpenAI-compatible Base URL (KKU OKMD, vLLM, LM Studio, Ollama) |
| `OPENAI_COMPAT_MODEL` | Optional | `claude-sonnet-4.6` | Default OpenAI-compatible Model ID |
| `APP_SECRET_KEY` | Production | `change-me-in-production` | Secret key |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/dashboard/summary?days=` | Readiness, HRV, RHR, sleep, strain, load cards |
| `GET` | `/api/dashboard/training-load?days=` | ACWR, daily load series |
| `GET` | `/api/dashboard/fitness-trend?days=` | VO2max, fitness estimates trend |
| `GET` | `/api/dashboard/personal-records` | PR trophy cabinet |
| `GET` | `/api/activities/?sport=&limit=&offset=` | Activity list with filter/pagination |
| `GET` | `/api/activities/{id}` | Single activity detail |
| `GET` | `/api/activities/{id}/records` | Per-second time-series (HR, speed, power, elevation) |
| `GET` | `/api/ai/models` | Available AI models (grouped by provider & flat IDs) |
| `GET` | `/api/ai/sessions` | List chat sessions |
| `POST` | `/api/ai/sessions` | Create new chat session |
| `PUT` | `/api/ai/sessions/{id}` | Update chat session (title, pinned status, model) |
| `DELETE` | `/api/ai/sessions/{id}` | Delete chat session |
| `GET` | `/api/ai/sessions/{id}/messages` | Get messages in a session |
| `POST` | `/api/ai/sessions/{id}/ask/stream` | Stream AI response for session (SSE) |
| `POST` | `/api/ai/ask` | Ask natural-language question |
| `POST` | `/api/ai/ask/stream` | Stream natural-language question response (SSE) |
| `GET` | `/api/ai/briefing` | Weekly training briefing |
| `GET` | `/api/ai/postmortem/{activity_id}` | Workout postmortem |
| `GET` | `/api/ai/postmortem/{activity_id}/stream` | Stream workout postmortem (SSE) |
| `POST` | `/api/sync/now` | Trigger manual sync |
| `GET` | `/api/sync/stream?job_id=` | SSE progress stream |
| `GET` | `/api/sync/status` | Last sync status |
| `GET` | `/api/settings/profile` | Get/update user profile |
| `GET` | `/api/settings/goal` | Get/update training goal |
| `GET` | `/api/training-plan/events?days_back=&days_forward=` | iCal training plan |
| `GET` | `/api/training-plan/today` | Today's training events |

---

## Project Structure

```
coros/
├── .env.example              # Environment template
├── docker-compose.yml        # PostgreSQL + Redis
├── backend/
│   ├── pyproject.toml        # Python deps & tool config
│   ├── migrations/           # Alembic migrations
│   └── src/
│       ├── main.py           # FastAPI entry point
│       ├── config.py         # Pydantic-settings
│       ├── db/
│       │   ├── engine.py     # Async SQLAlchemy session
│       │   └── models.py     # 11 ORM models (User, Activity, Health, Sleep, ChatSession, ChatMessage, etc.)
│       ├── api/routes/
│       │   ├── activity_routes.py
│       │   ├── ai_routes.py
│       │   ├── dashboard_routes.py
│       │   ├── settings_routes.py
│       │   ├── sync_routes.py
│       │   └── training_plan_routes.py
│       ├── sync/
│       │   ├── api_client.py    # COROS API auth + data fetching
│       │   └── sync_manager.py  # Orchestration, upsert, SSE events
│       ├── metrics/
│       │   ├── derived.py       # ACWR, efficiency, HR zones, strain, biological age
│       │   ├── baselines.py     # Rolling baseline, SMA, z-score
│       │   └── anomaly.py       # Z-score and IQR anomaly detection
│       └── ai/
│           ├── __init__.py         # Multi-provider dynamic dispatch layer & model resolver
│           ├── gemini_client.py    # Google Gemini Direct SDK wrapper
│           ├── openai_compat_client.py # OpenAI Chat Completions API wrapper (OKMD, vLLM, LM Studio)
│           ├── context_builder.py  # Builds markdown training & lap context from DB
│           └── prompts.py          # System prompts (coach, briefing, postmortem)
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx              # Dashboard
│       │   ├── activities/           # Activity list + detail
│       │   ├── ai/page.tsx           # AI chat with session management & provider-grouped model picker
│       │   ├── fitness/page.tsx      # VO2max, race predictor, pace zones
│       │   ├── plan/page.tsx         # iCal training plan
│       │   ├── settings/page.tsx     # Profile, goal, sync/AI config
│       │   ├── sleep/page.tsx        # HRV, sleep stages, recovery
│       │   └── trends/page.tsx       # ACWR, training load chart
│       ├── components/
│       │   ├── Sidebar.tsx           # 5-section navigation
│       │   └── SyncButton.tsx        # Sync trigger with SSE progress
│       └── lib/
│           ├── api.ts                # fetch + SSE helper
│           └── types.ts              # TypeScript interfaces
└── scratch/                      # Development scratchpad
```