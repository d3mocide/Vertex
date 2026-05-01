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

## Design System Rules — Mandatory for All Frontend Changes

The Vertex Design System (`vertex-design-system.html`) is the source of truth for every visual decision. Run `/design-system` at the start of any frontend task to load the full token and component reference.

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
- **No test suite** — validate changes manually via Docker Compose and browser.

---

## Pitfalls to Avoid

- **Do not add `any` types in TypeScript** — strict mode is on and it will cascade into harder-to-catch bugs.
- **Do not forget `--noEmit` type check** before committing frontend changes. The Docker build has no grace period for type errors.
- **Do not add sync I/O in async Python contexts** — use `httpx.AsyncClient`, `asyncpg`, and `aioredis` throughout.
- **Do not hard-code region coordinates** — use `config.py` Pydantic Settings that read from `.env`.
- **Do not commit `.env` files** — `.gitignore` covers them but double-check.
- **When modifying `docker-compose.yml`**, always run `docker compose config --quiet` to catch YAML errors before pushing.
