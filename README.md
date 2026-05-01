# Vertex

> See your neighborhood sharper

Vertex is a local-first, real-time situational awareness dashboard. It combines aircraft, vessels, traffic, weather, alerts, radio, and community feeds into a single map-centric interface designed to run on hardware you control.

Part of the [Sovereign Watch](https://github.com/d3mocide) family of local intelligence tools.

## Documentation

Detailed documentation lives in the [docs](docs/README.md) directory.

- [Getting Started](docs/getting-started.md)
- [Architecture Overview](docs/architecture/overview.md)
- [Feature Overview](docs/features/overview.md)
- [Environment Configuration](docs/configuration/environment.md)
- [Source Configuration](docs/configuration/sources.md)

## At A Glance

- Five-container local stack: PostgreSQL/PostGIS, Redis, backend, poller, frontend
- Map-centric UI with live entities, trails, overlays, and side panels
- Config split between `.env` and `config/sources.yml`
- Supports local-first integrations such as Ultrafeeder, AIS-catcher, OP25, and MeshCore
- Optional automation features including geofences, auth, summaries, and webhooks

## Quick Start

```bash
cp .env.example .env
cp config/sources.example.yml config/sources.yml
docker compose up -d
```

Then open `http://localhost`.

For setup details and configuration guidance, continue in [docs/getting-started.md](docs/getting-started.md).

## License

GPL-3.0. See [LICENSE](LICENSE).
