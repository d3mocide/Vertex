# Vertex — Agent Orientation

Vertex is a local-first, real-time situational awareness dashboard. It fuses aircraft, vessel, weather, traffic, emergency alerts, and P25 trunked radio into a single map-centric interface, built for modest self-hosted hardware (developed and run on a Linux VM; Raspberry Pi 5 is the design target but untested).

**The mandatory agent rules, checklists, and skills are in the second half of this file — every agent working in this repo must follow them exactly.** (`AGENTS.md` only points here.)

---

## Architecture

Seven containers (plus an optional `tileserver`):

| Container | Role | Entry point |
|-----------|------|-------------|
| `db` | PostgreSQL 16 + PostGIS 3.4 | Init scripts in `db/` |
| `redis` | State cache + pub/sub event bus | Stock image |
| `mosquitto` | MQTT broker for IoT sensors (rtl_433, Meshtastic) | `infra/mosquitto/` |
| `backend` | FastAPI REST + WebSocket API | `backend/main.py` |
| `poller` | Async pollers, one module per data source | `poller/main.py` |
| `transcription` | Speech-to-text for recorded radio calls | `transcription/main.py` |
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
  routers/        API route modules + WebSocket handler

poller/           Background data pollers
  main.py         Entry point, runs all pollers concurrently
  config.py       Pydantic Settings (same schema as backend)
  db.py           Async DB queries (bulk inserts, geofence lookups)
  geofence.py     Entry/exit detection engine → Redis pub/sub
  pollers/        One file per data source (adsb, ais, weather, alerts, news,
                  traffic, utilities, p25, meshcore, fire, lightning, and more)

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
docs/notes/       Architecture notes and deep-dives
docs/design/      Design-system and icon-atlas reference pages
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
    poller (async task per source)
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
| `/capabilities` | Which regional data contracts have a provider here (drives what the UI shows) |
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

---

# Agent Rules & Workflows

## Privacy & Repository Hygiene — Mandatory

This is a public repository. Nothing that identifies a person, their machine, or their location may be committed — in code, docs, `TASK_LOG.md`, commit messages, tests, screenshots, or comments.

- **Never write working-directory or absolute paths** — no `/home/<user>/…`, `/Users/<user>/…`, `C:/…`, or other machine-specific paths. Use repo-relative paths (`poller/pollers/adsb.py`). This includes `TASK_LOG.md` entries and Markdown links (`[adsb.py](poller/pollers/adsb.py)`, never `file:///…`).
- **Never write usernames, personal names, hostnames, email addresses, or LAN IPs** (`192.168.x.x`, `10.x`, `*.local`, personal domains). Use placeholders (`<sdr-host>`, `192.168.1.100` in examples).
- **Never write real coordinates for an operator's home, receiver, or devices.** Use the generic defaults from `.env.example`; real values live only in `.env` (gitignored).
- **Never commit secrets** — `.env`, API keys, client secrets, passwords, tokens, Icecast/OP25 credentials. Do not paste them into chat, logs, or docs either.
- **Screenshots and recordings** must be reviewed before commit: no real home location, personal devices, credentials, LAN addresses, or private residential addresses. Prefer a relocated map pin and skip screens showing other people's private messages.
- Before every commit, scan your diff: `git diff --cached | grep -nE '/home/|/Users/|[A-Za-z]:/|192\.168\.|@gmail|password|secret|api[_-]?key'` and resolve every hit.

---

## Mandatory Rules

### Before Starting Any Task

1. Do not run codebase discovery if the architecture map above already answers your question.
2. Check `TASK_LOG.md` to understand recent changes and any open issues.
3. Identify which services your changes touch (backend, poller, frontend, Docker config).
4. Ensure frontend dependencies are installed — if `frontend/node_modules/` is absent or stale, run `cd frontend && npm install` before doing anything. Without this, `tsc` will report hundreds of false errors and any TypeScript check is meaningless.

### Before Every Commit

Run all of these. Do not commit if any fail.

```bash
# 1. TypeScript type check (frontend Docker build will fail if this fails)
#    node_modules must be installed first — run npm install if missing
cd frontend && npm install && npx tsc --noEmit
# PASS = exit code 0, zero errors printed. ANY error = FAIL.
# Do NOT rationalize errors as "pre-existing" or "baseline" — if tsc prints
# even one error the check has failed and you must fix it before committing.

# 2. Docker Compose config validation
docker compose config --quiet

# 3. Python syntax check on staged Python files
git diff --cached --name-only | grep '\.py$' | xargs -r python3 -m py_compile
```

**TypeScript pass definition:** `npx tsc --noEmit` exits with code 0 and prints no errors. Comparing error counts before and after your change is not a valid pass. Pre-existing errors do not excuse new or unchanged errors — fix them.

Use the `/pre-commit-check` skill to run all three automatically.

### After Completing Any Task

Update `TASK_LOG.md` using the `/update-task-log` skill or by appending an entry manually.

---

## Available Skills (Slash Commands)

| Command | What it does |
|---------|--------------|
| `/design-system` | Loads the full Vertex Design System token reference — run before any frontend task |
| `/typecheck` | Runs TypeScript type check on the frontend |
| `/pre-commit-check` | Runs all validation checks (TS types, Docker config, Python syntax) |
| `/docker-validate` | Validates Docker Compose YAML syntax |
| `/update-task-log` | Appends a completed-work entry to TASK_LOG.md |

---

## Development Workflow

### Making a backend or poller change

1. Edit files in `backend/` or `poller/`
2. Check Python syntax: `python3 -m py_compile <changed_file.py>`
3. If you added a dependency, add it to the relevant `requirements.txt`
4. Rebuild and restart: `docker compose build backend && docker compose up -d backend`
5. Verify with: `docker compose logs -f backend`

### Making a frontend change

1. Edit files in `frontend/src/`
2. Ensure dependencies are installed: `cd frontend && npm install`
3. Run type check: `cd frontend && npx tsc --noEmit` — must exit code 0 with zero errors printed. Fix every error before proceeding. A delta comparison ("I didn't introduce these errors") is not acceptable — all errors must be resolved.
4. For visual changes, run the dev server: `cd frontend && npm run dev`
5. For production validation: `cd frontend && npm run build` (this is what Docker runs)
6. Never commit frontend changes with TypeScript errors — the Docker build runs `tsc && vite build` and will fail

### Adding a new poller

1. Create `poller/pollers/<name>.py` implementing the poller class
2. Register it in `poller/main.py`
3. Add any new config vars to `poller/config.py` (Pydantic Settings) and `.env.example`
4. Add a new API route in `backend/routers/` if the frontend needs to query this data
5. Register the router in `backend/main.py`
6. **Whitelist Proxy Endpoints**: If the new feed includes a proxy endpoint (e.g., WMS tiles) accessed directly by the map library without auth headers, you **must** add its prefix to `_PUBLIC_PREFIXES` in `backend/auth_middleware.py`.

### Modifying the database schema

1. Edit `backend/db/models.py` (SQLAlchemy ORM)
2. Update `db/` init SQL scripts to match
3. Drop and recreate the `db_data` volume in dev: `docker compose down -v && docker compose up -d`
4. Update poller DB queries in `poller/db.py` if affected

### Changing Docker configuration

1. Edit `docker-compose.yml`
2. Validate: `docker compose config --quiet`
3. For Dockerfile changes, do a full build: `docker compose build <service>`

---

## Architecture Quick Reference

```
poller → PostgreSQL ← backend → frontend (via REST)
poller → Redis pub/sub → backend → frontend (via WebSocket /ws)
```

**Poller cadences:**
- ADSB: 5s (OpenSky or local Ultrafeeder)
- AIS: WebSocket stream (AISstream.io or local AIS-catcher)
- Weather: 5 min
- Alerts / News / Traffic: 60s
- P25: WebSocket stream (OP25)
- MeshCore: WebSocket stream

**Frontend state flow:**
`useWebSocket.ts` → Zustand `store.ts` → `buildEntityLayers.ts` / `buildTrailLayers.ts` → Deck.gl → MapLibre GL

---

## Map Layer Architecture Rules (Mandatory)

Map presentation is split by responsibility. Follow these rules for all new or modified map layers.

### 1) Where layers must be built

- **Deck.gl (`frontend/src/layers/` + `MapOverlay.tsx`)**:
	- all operational indicators and dynamic entities,
	- all selectable symbols, rings, pulses, labels, trails,
	- all high-frequency or websocket-updated overlays.
- **MapLibre (`frontend/src/components/layers/`)**:
	- basemap/style only,
	- raster/weather tile sources (radar, smoke),
	- terrain DEM source/exaggeration,
	- map controls and native map interaction plumbing.

### 2) Why

- Deck.gl gives a single rendering/picking pipeline for tactical overlays.
- It avoids style-layer ordering conflicts and CSS/filter side effects on many independent MapLibre symbol layers.
- It centralizes declutter logic (zoom gating, density caps, label policies) in one place.

### 3) Declutter standards

- Do not add always-on labels for dense feeds by default.
- Label visibility must be zoom-gated and/or density-limited.
- Prefer icon/ring-only defaults with details surfaced in hover/click tooltips.

### 4) Exceptions

- If a non-basemap indicator must remain MapLibre, document:
	- why Deck.gl is not viable,
	- expected lifetime of the exception,
	- migration plan back to Deck.
	Add this note in `TASK_LOG.md` and the map-layer research artifact.

### 5) Authentication for Map Layers

- Standard data endpoints (REST/WS) must remain authenticated.
- Proxy endpoints for map tiles (WMS/Raster) that are called directly by the map engine without easy header injection should be whitelisted in `backend/auth_middleware.py`.
- **Never** whitelist mutating methods (POST/PUT/DELETE) or sensitive data endpoints.

---

## Design System Rules — Mandatory for All Frontend Changes

The Vertex Design System (`docs/design/vertex-design-system.html`) is the source of truth for every visual decision. Run `/design-system` at the start of any frontend task to load the full token and component reference.

### Before Writing Any Frontend Code

1. Run `/design-system` to load the token and component reference into context.
2. Confirm you are using Tailwind tokens from `tailwind.config.js` — never hardcode hex values in TSX (inline `style` gradient stops are the only exception).
3. Check that your component uses an existing CSS class from `index.css` before inventing a new one.

### Rules That Must Never Be Violated

| Rule | Detail |
|------|--------|
| **0px radius** | Never use `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`. Only `rounded-full` for circular indicators. |
| **Color tokens only** | Use Tailwind token names (`text-amber-gold`, `bg-red-emergency`, etc.) not hex values in JSX. |
| **Signal colors are semantic** | `cyan-adsb` = aircraft only · `green-ais` = vessels/nominal · `amber-p25` = radio · `red-emergency` = emergencies. Never decorative. |
| **Amber-gold is accent, not decoration** | Every use of `#FFB800` must carry signal meaning (active state, live data, primary action). |
| **Roboto Mono for data** | All numbers, coordinates, timestamps, IDs, callsigns must use `font-mono` (`font-family: 'Roboto Mono'`). |
| **Logo mark is immutable** | The Scope mark SVG (Direction 07) lives canonically in `Sidebar.tsx`. Copy it exactly — do not approximate with CSS or emoji. |
| **Dark only** | No light-mode code, no `dark:` class conditionals. The `dark` class is always present on `<html>`. |
| **Material Symbols only** | No emoji in UI chrome. No other icon libraries. Use `<span className="ms">icon_name</span>` and `.ms-fill` for filled variants. |
| **Buttons from index.css** | Use `.btn-primary`, `.btn-ghost`, or `.btn-danger`. Do not create ad-hoc button styles. |

### Logo Wordmark Lockups

Two approved compositions — use the correct one for the context:

- **Horizontal lockup** (sidebar, header) — 28px Scope mark + "VERTEX" (Inter 900, 16px) + "SITUATIONAL AWARENESS" (Roboto Mono, 9px, amber-gold). Reference: `Sidebar.tsx`.
- **Stacked lockup** (login, splash, boot) — 56px Scope mark above "VERTEX" (Inter 900, 22px) above "SITUATIONAL AWARENESS" (Roboto Mono, 9px, amber-gold). Reference: `LoginPage.tsx`.

### Approved Component Pattern Library

Always prefer an existing pattern over a new one:

- **Glassmorphic panels** — `.hud-panel`, `.glass-morphism`
- **HUD card with corner brackets** — see pattern in `LoginPage.tsx` Shell component
- **Amber gradient header underline** — see pattern in `Header.tsx`
- **Section headings** — `.section-heading`
- **Data labels** — `.label-caps` + `.data-value`
- **Status pills** — `.status-pill` with `.tl-green`, `.tl-yellow`, `.tl-red`
- **Incident cards** — `.incident-card`

---

## Code Style Conventions

- **Python**: No type annotations required but Pydantic models are used at API boundaries. Async/await throughout — no sync DB or network calls in async contexts.
- **TypeScript**: Strict mode enabled. All props and store slices must be typed. No `any` unless absolutely unavoidable.
- **No linter configured** — be conservative: follow existing patterns, no unused imports, no console.log left in frontend code.


---

## Dependency Security Rules — Mandatory

### Adding Any New Package

Before adding any new npm or Python package to this repo, you **must** do all of the following:

1. **Check the package's reputation** — look at download count, maintainer history, and whether it is actively maintained. Prefer packages with large, established communities over unknown single-maintainer packages.
2. **Scan for known CVEs** — search the package name on [osv.dev](https://osv.dev) and [socket.dev](https://socket.dev) before installing.
3. **Audit immediately after installing:**
   - npm: `cd frontend && npm audit`
   - Python: `pip-audit -r <requirements_file>`
4. **Pin to an exact version** — never use ranges (`^`, `~`, `>=`):
   - npm: exact version string, no caret — e.g. `"vite": "6.4.2"` not `"^6.4.2"`
   - Python: `==` pin — e.g. `litellm==1.83.14` not `litellm>=1.83`
5. **Document why the package is needed** in the commit message or PR — if you cannot justify adding it, do not add it.

### Updating Existing Packages

- Never run `npm update`, `pip install -U`, or equivalent without first checking the changelog for the target version range.
- After any version bump, re-run the full audit (`npm audit` / `pip-audit`) to confirm zero vulnerabilities.
- Pin to the new exact version — do not widen the constraint.

### Routine Audits

Run both audits as part of any task that touches `package.json`, `backend/requirements.txt`, or `poller/requirements.txt`:

```bash
# npm
cd frontend && npm audit

# Python (backend)
pip-audit -r backend/requirements.txt

# Python (poller)
pip-audit -r poller/requirements.txt
```

A clean audit is zero findings in all three. Do not commit if any findings remain unresolved.

---

## Pitfalls to Avoid

- **Do not add `any` types in TypeScript** — strict mode is on and it will cascade into harder-to-catch bugs.
- **Do not forget `--noEmit` type check** before committing frontend changes. The Docker build has no grace period for type errors. A passing check means exit code 0 and zero errors — never rationalize errors as "pre-existing" or "baseline". Run `npm install` first if `node_modules` is absent.
- **Do not compare error counts before/after your change** to declare a "pass". TypeScript either passes (zero errors, exit 0) or it fails. Fix every error you find.
- **Do not add sync I/O in async Python contexts** — use `httpx.AsyncClient`, `asyncpg`, and `aioredis` throughout.
- **Do not hard-code region coordinates** — use `config.py` Pydantic Settings that read from `.env`.
- **Do not commit `.env` files** — `.gitignore` covers them but double-check.
- **When modifying `docker-compose.yml`**, always run `docker compose config --quiet` to catch YAML errors before pushing.
