# Contributing

Thanks for helping. Vertex is a small project, so keep changes focused and easy to review.

## Setup

```bash
cp .env.example .env
cp config/sources.example.yml config/sources.yml
docker compose up -d                # full stack
cd frontend && npm install && npm run dev   # hot-reload frontend
```

## Before you open a pull request

```bash
cd frontend && npx tsc --noEmit                 # must print nothing
docker compose config --quiet
cd poller && pytest tests/                       # and: cd backend && pytest tests/
```

CI runs the same checks. Add or update tests for behaviour you change, and add an entry to `TASK_LOG.md`.

## Conventions

- Frontend: TypeScript strict, Tailwind tokens only, follow the design system in `docs/design/vertex-design-system.html`.
- Python: async throughout; configuration via `config.py` (Pydantic Settings) and `.env.example`.
- Pin new dependencies to exact versions and audit them (`npm audit`, `pip-audit`).
- Full agent/contributor rules, including map-layer and design-system rules, are in [`CLAUDE.md`](CLAUDE.md).

## Keep it private

Never commit secrets, personal paths (`/home/<you>/…`), hostnames, LAN IPs, or real home/receiver coordinates, and check screenshots before including them. Details are in the *Privacy & Repository Hygiene* section of `CLAUDE.md`.
