# Vertex Dependency Overview

Last audited: 2026-04-24. Run `npm audit` and `pip-audit` to re-check.

---

## Security Audit Status

| Stack | Tool | Result |
|-------|------|--------|
| Frontend (Node) | `npm audit` | ✅ 0 vulnerabilities |
| Backend (Python) | `pip-audit` | ✅ 0 vulnerabilities |
| Poller (Python) | `pip-audit` | ✅ 0 vulnerabilities |

### Vulnerabilities Fixed in This Audit

| Package | CVE / Advisory | Severity | Fixed By |
|---------|---------------|----------|----------|
| starlette 0.38.6 | CVE-2024-47874 | Moderate | Upgrade to starlette 0.49.3 |
| starlette 0.38.6 | CVE-2025-54121 | Low | Upgrade to starlette 0.49.3 |
| starlette 0.47.3 | CVE-2025-62727 | Moderate | Upgrade to starlette 0.49.3 + fastapi 0.122.0 |
| vite ≤6.4.1 | GHSA-4w7w-66w2-5vf9 | Moderate | Upgrade vite to 6.4.2 (dev only) |
| esbuild ≤0.24.2 | GHSA-67mh-4wv8-2f99 | Moderate | Fixed transitively via vite 6.4.2 (dev only) |

> **Note on Vite/esbuild CVEs:** Both affect the Vite **development server** only. Production builds are served by Nginx; the dev server is never exposed in deployment. Severity is lower in practice.

---

## Lock Files

| Stack | File | Format |
|-------|------|--------|
| Frontend | `frontend/package-lock.json` | npm lockfile v3 |
| Backend | `backend/requirements.lock` | pip-compile output |
| Poller | `poller/requirements.lock` | pip-compile output |

To regenerate Python lock files after changing `requirements.txt`:

```bash
pip install pip-tools
pip-compile backend/requirements.txt --output-file backend/requirements.lock
pip-compile poller/requirements.txt --output-file poller/requirements.lock
```

---

## Backend Dependencies (`backend/requirements.txt`)

| Package | Pinned | Resolved | Purpose |
|---------|--------|----------|---------|
| fastapi | 0.122.0 | 0.122.0 | ASGI web framework — REST API and WebSocket routing |
| starlette | 0.49.3 | 0.49.3 | ASGI toolkit — request/response primitives (pinned explicitly for CVE fixes) |
| uvicorn[standard] | 0.30.6 | 0.30.6 | ASGI server — runs FastAPI under Python |
| sqlalchemy[asyncio] | 2.0.36 | 2.0.36 | ORM with async support — entity, observation, event, geofence models |
| asyncpg | 0.30.0 | 0.30.0 | Pure-Python async PostgreSQL driver — used by SQLAlchemy |
| geoalchemy2 | 0.15.2 | 0.15.2 | SQLAlchemy PostGIS extension — geospatial types and ST_ queries |
| redis[hiredis] | 5.2.0 | 5.2.0 | Redis client + hiredis C parser — pub/sub event bus |
| pydantic | 2.9.2 | 2.9.2 | Data validation and serialization — request/response models |
| pydantic-settings | 2.6.1 | 2.6.1 | Environment-based config via `.env` files |
| httpx | 0.28.0 | 0.28.0 | Async HTTP client — outbound API calls from routers |
| python-dateutil | 2.9.0 | 2.9.0 | Date parsing utilities |

### Transitive dependencies (lock file only)

| Package | Resolved | Via |
|---------|----------|-----|
| annotated-doc | 0.0.4 | fastapi |
| annotated-types | 0.7.0 | pydantic |
| anyio | 4.13.0 | httpx, starlette, watchfiles |
| certifi | 2026.4.22 | httpx |
| click | 8.3.3 | uvicorn |
| greenlet | 3.4.0 | sqlalchemy |
| h11 | 0.16.0 | httpcore, uvicorn |
| hiredis | 3.3.1 | redis |
| httpcore | 1.0.9 | httpx |
| httptools | 0.7.1 | uvicorn |
| idna | 3.13 | anyio, httpx |
| packaging | 26.1 | geoalchemy2 |
| pydantic-core | 2.23.4 | pydantic |
| python-dotenv | 1.2.2 | pydantic-settings, uvicorn |
| pyyaml | 6.0.3 | uvicorn |
| six | 1.17.0 | python-dateutil |
| typing-extensions | 4.15.0 | anyio, fastapi, pydantic, sqlalchemy, starlette |
| uvloop | 0.22.1 | uvicorn |
| watchfiles | 1.1.1 | uvicorn |
| websockets | 16.0 | uvicorn |

---

## Poller Dependencies (`poller/requirements.txt`)

| Package | Pinned | Resolved | Purpose |
|---------|--------|----------|---------|
| redis[hiredis] | 5.2.0 | 5.2.0 | Redis pub/sub — publishes entity_update and geofence_event messages |
| httpx | 0.28.0 | 0.28.0 | Async HTTP client — all 9 pollers use this for external API calls |
| asyncpg | 0.30.0 | 0.30.0 | Async PostgreSQL driver — bulk inserts in `poller/db.py` |
| sqlalchemy[asyncio] | 2.0.36 | 2.0.36 | ORM — same schema as backend |
| pydantic-settings | 2.6.1 | 2.6.1 | Config from `.env` — mirrors backend config schema |
| python-dateutil | 2.9.0 | 2.9.0 | Date parsing for API response timestamps |
| feedparser | 6.0.11 | 6.0.11 | RSS/Atom parser — alerts and news pollers |
| websockets | 13.1 | 13.1 | WebSocket client — AISstream and MeshCore connections |

### Transitive dependencies (lock file only)

| Package | Resolved | Via |
|---------|----------|-----|
| annotated-types | 0.7.0 | pydantic |
| anyio | 4.13.0 | httpx |
| certifi | 2026.4.22 | httpx |
| greenlet | 3.4.0 | sqlalchemy |
| h11 | 0.16.0 | httpcore |
| hiredis | 3.3.1 | redis |
| httpcore | 1.0.9 | httpx |
| idna | 3.13 | anyio, httpx |
| pydantic | 2.13.3 | pydantic-settings |
| pydantic-core | 2.46.3 | pydantic |
| python-dotenv | 1.2.2 | pydantic-settings |
| sgmllib3k | 1.0.0 | feedparser |
| six | 1.17.0 | python-dateutil |
| typing-extensions | 4.15.0 | anyio, pydantic, sqlalchemy |
| typing-inspection | 0.4.2 | pydantic |

---

## Frontend Dependencies (`frontend/package.json`)

### Production

| Package | Range | Resolved | Purpose |
|---------|-------|----------|---------|
| @deck.gl/core | ^9.1.0 | 9.3.1 | Deck.gl rendering engine — WebGL2 layer management |
| @deck.gl/extensions | ^9.1.0 | 9.3.1 | Deck.gl extensions — terrain, mask, and data filter |
| @deck.gl/layers | ^9.1.0 | 9.3.1 | Deck.gl layer types — ScatterplotLayer, PathLayer, IconLayer |
| maplibre-gl | ^4.7.1 | 4.7.1 | MapLibre GL JS — base map renderer (OpenStreetMap tiles) |
| react | ^18.3.1 | 18.3.1 | React UI library — component tree and hooks |
| react-dom | ^18.3.1 | 18.3.1 | React DOM renderer |
| zustand | ^5.0.1 | 5.0.12 | State management — entities, events, alerts, audio, radio |

### Development

| Package | Range | Resolved | Purpose |
|---------|-------|----------|---------|
| @types/react | ^18.3.12 | 18.3.28 | TypeScript types for React |
| @types/react-dom | ^18.3.1 | 18.3.7 | TypeScript types for React DOM |
| @vitejs/plugin-react | ^4.3.3 | 4.7.0 | Vite plugin — Babel Fast Refresh for React |
| autoprefixer | ^10.4.20 | 10.5.0 | PostCSS plugin — vendor-prefixes CSS |
| postcss | ^8.4.49 | 8.5.10 | CSS transformation pipeline |
| tailwindcss | ^3.4.17 | 3.4.19 | Utility-first CSS framework |
| typescript | ^5.6.3 | 5.9.3 | TypeScript compiler — strict mode enforced |
| vite | ^6.4.2 | 6.4.2 | Build tool and dev server (upgraded from 5.4.10 for CVE fix) |

---

## How to Re-Audit

```bash
# Frontend
cd frontend && npm audit

# Python (install pip-audit once: pip install pip-audit)
pip-audit --requirement backend/requirements.txt
pip-audit --requirement poller/requirements.txt

# Full scan with JSON output
npm audit --json > frontend/audit.json
pip-audit --requirement backend/requirements.txt --format json > backend/audit.json
pip-audit --requirement poller/requirements.txt --format json > poller/audit.json
```
