# Vertex — Agent Rules & Workflows

This file defines behavioral rules for AI coding agents working on this project.
For project architecture and command reference, see `CLAUDE.md`.
For progress history, see `TASK_LOG.md`.

---

## Mandatory Rules

### Before Starting Any Task

1. Read `CLAUDE.md` if you have not already — it contains the full architecture map, tech stack, and common failure modes. Do not run codebase discovery if CLAUDE.md already answers your question.
2. Check `TASK_LOG.md` to understand recent changes and any open issues.
3. Identify which services your changes touch (backend, poller, frontend, Docker config).

### Before Every Commit

Run all of these. Do not commit if any fail.

```bash
# 1. TypeScript type check (frontend Docker build will fail if this fails)
cd /home/user/Vertex/frontend && npx tsc --noEmit

# 2. Docker Compose config validation
cd /home/user/Vertex && docker compose config --quiet

# 3. Python syntax check on staged Python files
cd /home/user/Vertex && git diff --cached --name-only | grep '\.py$' | xargs -r python3 -m py_compile
```

Use the `/pre-commit-check` skill to run all three automatically.

### After Completing Any Task

Update `TASK_LOG.md` using the `/update-task-log` skill or by appending an entry manually.

---

## Available Skills (Slash Commands)

| Command | What it does |
|---------|--------------|
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
2. Run type check: `cd frontend && npx tsc --noEmit` — fix all errors before proceeding
3. For visual changes, run the dev server: `cd frontend && npm run dev`
4. For production validation: `cd frontend && npm run build` (this is what Docker runs)
5. Never commit frontend changes with TypeScript errors — the Docker build runs `tsc && vite build` and will fail

### Adding a new poller

1. Create `poller/pollers/<name>.py` implementing the poller class
2. Register it in `poller/main.py`
3. Add any new config vars to `poller/config.py` (Pydantic Settings) and `.env.example`
4. Add a new API route in `backend/routers/` if the frontend needs to query this data
5. Register the router in `backend/main.py`

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

## Code Style Conventions

- **Python**: No type annotations required but Pydantic models are used at API boundaries. Async/await throughout — no sync DB or network calls in async contexts.
- **TypeScript**: Strict mode enabled. All props and store slices must be typed. No `any` unless absolutely unavoidable.
- **No linter configured** — be conservative: follow existing patterns, no unused imports, no console.log left in frontend code.
- **No test suite** — validate changes manually via Docker Compose and browser.

---

## Pitfalls to Avoid

- **Do not add `any` types in TypeScript** — strict mode is on and it will cascade into harder-to-catch bugs.
- **Do not forget `--noEmit` type check** before committing frontend changes. The Docker build has no grace period for type errors.
- **Do not add sync I/O in async Python contexts** — use `httpx.AsyncClient`, `asyncpg`, and `aioredis` throughout.
- **Do not hard-code region coordinates** — use `config.py` Pydantic Settings that read from `.env`.
- **Do not commit `.env` files** — `.gitignore` covers them but double-check.
- **When modifying `docker-compose.yml`**, always run `docker compose config --quiet` to catch YAML errors before pushing.
