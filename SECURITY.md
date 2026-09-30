# Security Policy

## Reporting a vulnerability

Please report security issues privately using GitHub's **Report a vulnerability** button on the repository's *Security* tab. Do not open a public issue for anything exploitable.

Include what you found, how to reproduce it, and the version or commit. You can expect an acknowledgement within a few days.

## Scope and deployment notes

Vertex is designed to run on a private network. If you expose it to the internet:

- Put it behind TLS (`docker-compose.tls.yml`) and keep authentication enabled; REST and WebSocket endpoints require a login or API key.
- Restrict `CORS_ORIGINS` to the origins you actually use.
- Keep `.env` and `config/sources.yml` out of version control — they hold API keys and internal addresses.
- Only the map-tile proxy prefixes listed in `backend/auth_middleware.py` are served without auth headers; never add mutating or sensitive endpoints to that list.

Dependency policy: exact-version pins and an audit (`npm audit`, `pip-audit`) on every dependency change — see `CLAUDE.md`.
