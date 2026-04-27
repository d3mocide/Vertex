# Vertex — Agent Orientation

Vertex is a local-first, real-time situational awareness dashboard. It fuses aircraft, vessel, weather, traffic, emergency alerts, and P25 trunked radio into a single map-centric interface, designed to run on a Raspberry Pi 5.

**See `Agents.md` for mandatory agent rules, pre-commit checklists, and available skills.**

---

## Architecture

Five core containers:

| Container | Role | Entry point |
|-----------|------|-------------|
| `db` | PostgreSQL 16 + PostGIS 3.4 | Init scripts in `db/` |
| `redis` | State cache + pub/sub event bus | Stock image |
| `backend` | FastAPI REST + WebSocket API | `backend/main.py` |
| `poller` | 9 async background pollers | `poller/main.py` |
| `frontend` | React + MapLibre GL, Nginx-served | `frontend/src/main.tsx` |

---

## Directory Map

```
backend/          FastAPI app
  main.py         Entry point, app factory, router registration
  config.py       Pydantic Settings (reads from .env)
  db/
    models.py     SQLAlchemy ORM models (entities, observations, events, geofences)
    session.py    Async connection pool
  redis_bus.py    Redis pub/sub event broker
  routers/        9 API route modules + WebSocket handler

poller/           Background data pollers
  main.py         Entry point, runs 9 pollers concurrently
  config.py       Pydantic Settings (same schema as backend)
  db.py           Async DB queries (bulk inserts, geofence lookups)
  geofence.py     Entry/exit detection engine → Redis pub/sub
  pollers/        One file per data source (adsb, ais, weather, alerts, news,
                  traffic, utilities, p25, meshcore)

frontend/
  src/
    main.tsx      React entry point
    App.tsx       Root layout, panel composition
    store.ts      Zustand global state
    config.ts     API endpoints, map bounds, region settings
    hooks/
      useWebSocket.ts  Real-time event stream from backend /ws
    components/
      Map.tsx     MapLibre GL base map
    layers/       Deck.gl overlay builders (entities, trails, cameras)
    panels/       5 info panels (entity, weather, traffic, alerts, audio)

db/               PostgreSQL init SQL scripts
config/           sources.yml — canonical config for radio streams, news feeds, pollers, alert zones
infra/            Redis config
research/         Architecture notes and deep-dives
```

---

## Tech Stack

**Backend / Poller** — Python 3.12, FastAPI 0.115, SQLAlchemy 2.0 async, asyncpg, GeoAlchemy2, Redis hiredis, Pydantic Settings, httpx, websockets

**Frontend** — TypeScript 5.6 (strict mode), React 18.3, Vite 5.4, MapLibre GL 4.7, Deck.gl 9.1, Zustand 5.0, TailwindCSS 3.4

**Database** — PostgreSQL 16 + PostGIS 3.4

**Infrastructure** — Docker Compose (multi-platform amd64/arm64), Nginx, Redis 7

---

## Key Commands

### Validation (run before every commit)

```bash
# TypeScript type check — must pass or Docker frontend build will fail
cd frontend && npx tsc --noEmit

# Validate Docker Compose syntax
docker compose config --quiet

# Python syntax check on modified files
git diff --cached --name-only | grep '\.py$' | xargs -r python3 -m py_compile
```

### Development

```bash
# Start core stack
docker compose up -d

# View logs
docker compose logs -f backend
docker compose logs -f poller

# Rebuild a single service
docker compose build backend && docker compose up -d backend

# Frontend dev server (hot reload)
cd frontend && npm run dev
```

### Frontend build (what Docker runs)

```bash
cd frontend && npm run build    # tsc && vite build
```

---

## Data Flow

```
External APIs / SDR hardware
        ↓
    poller (9 async tasks)
        ↓ bulk INSERT
      PostgreSQL ← GeoAlchemy2 geofence queries
        ↓ Redis pub/sub (entity_update, geofence_event)
      Redis
        ↓
    backend WebSocket /ws
        ↓ JSON events
    frontend Zustand store → Deck.gl layers → MapLibre GL map
```

---

## API Surface

Base path: `/api/v1/`

| Route | Description |
|-------|-------------|
| `/entities` | Aircraft, vessels, mesh nodes (last known position) |
| `/observations` | Position history (30-day trail) |
| `/events` | Geofence entry/exit and P25 call events |
| `/weather` | NWS observations and active alerts |
| `/alerts` | FlashAlert + county EM RSS feeds |
| `/news` | Aggregated RSS news feeds |
| `/traffic` | ODOT incidents, camera streams, flow data |
| `/radio` | P25 stream metadata |
| `/utilities` | Geofence CRUD |
| `/ws` | WebSocket event stream |

---

## Environment

Configuration is entirely via `.env` files loaded by Pydantic Settings. Key variables:

```
DATABASE_URL         asyncpg connection string
REDIS_URL            redis:// connection string
REGION_LAT/LON       Map center
BBOX_*               Bounding box for data queries
ODOT_API_KEY         ODOT TripCheck (traffic)
AISSTREAM_API_KEY    AISstream.io (vessels, if no local AIS-catcher)
AIRNOW_API_KEY       AirNow (AQI)
NWS_ZONE             NWS observation zone code
NWS_ALERT_ZONES      Comma-separated NWS alert zone codes
```

Copy `.env.example` as a starting point.

---

## Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Frontend Docker build fails | TypeScript type errors | Run `npx tsc --noEmit` in `frontend/`, fix all errors before building |
| Backend import errors | Missing dependency or wrong Python path | Check `backend/requirements.txt`, ensure `PYTHONPATH` includes app root |
| `asyncpg` connection refused | DB not healthy yet | Check `db` container health; backend has retry logic in `db/session.py` |
| Redis pub/sub missing events | Channel name mismatch | Confirm channel names in `redis_bus.py` match poller's publish calls |
| Geofence not triggering | PostGIS query issue | Check `poller/geofence.py` spatial query; requires PostGIS extension active |
