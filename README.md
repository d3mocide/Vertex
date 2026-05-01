<div align="center">

<img src="docs/logo.svg" alt="Vertex — Situational Awareness" width="220" />

<br />

![License](https://img.shields.io/badge/LICENSE-GPL--3.0-FFB800?style=flat-square&labelColor=050505&color=FFB800)
![Stack](https://img.shields.io/badge/STACK-Docker%20Compose-FFB800?style=flat-square&labelColor=050505&color=4D3800)
![Platform](https://img.shields.io/badge/PLATFORM-Raspberry%20Pi%205-FFB800?style=flat-square&labelColor=050505&color=4D3800)
![Theme](https://img.shields.io/badge/THEME-DARK%20ONLY-050505?style=flat-square&labelColor=FFB800&color=050505)

**Real-time situational awareness. Local-first. No cloud required.**

Part of the [Sovereign Watch](https://github.com/d3mocide) family of local intelligence tools.

</div>

---

## // 00 · BRIEF

Vertex fuses aircraft, vessel, traffic, weather, alerts, radio, and community feeds into a single map-centric dashboard designed to run on hardware you control. Onyx surfaces, amber-gold signal accents, and a desaturated tactical map keep the focus where it belongs — on the data.

```
DOMAIN · PUBLIC SAFETY    DENSITY · HIGH / DATA-FIRST
THEME  · DARK ONLY        RADIUS  · 0px / ALL
```

## // 01 · ARCHITECTURE

Five containers. One compose file.

| Container | Role | Entry point |
|-----------|------|-------------|
| `db` | PostgreSQL 16 + PostGIS 3.4 | `db/` init scripts |
| `redis` | State cache + pub/sub event bus | Stock image |
| `backend` | FastAPI REST + WebSocket API | `backend/main.py` |
| `poller` | 9 async background pollers | `poller/main.py` |
| `frontend` | React + MapLibre GL, Nginx-served | `frontend/src/main.tsx` |

```
External APIs / SDR hardware
        ↓
    poller (9 async tasks)
        ↓  bulk INSERT
    PostgreSQL ← PostGIS geofence queries
        ↓  Redis pub/sub
    backend WebSocket /ws
        ↓  JSON events
    frontend Zustand → Deck.gl → MapLibre GL
```

## // 02 · DATA SOURCES

| Signal | Color | Source |
|--------|-------|--------|
| Aircraft (ADS-B) | `#00BFFF` CYAN | OpenSky · local Ultrafeeder |
| Vessels (AIS) | `#00C853` GREEN | AISstream.io · local AIS-catcher |
| P25 Radio | `#FF8F00` AMBER | OP25 trunked radio |
| Emergency | `#C62828` RED | NWS alerts · FlashAlert · county EM |
| Traffic | `#FFB800` GOLD | ODOT TripCheck |
| Mesh | `#FFB800` GOLD | MeshCore nodes |

## // 03 · QUICK START

```bash
cp .env.example .env
cp config/sources.example.yml config/sources.yml

# Edit .env with your region, API keys, and data sources
$EDITOR .env

docker compose up -d
```

Open `http://localhost`. For detailed setup, see [docs/getting-started.md](docs/getting-started.md).

## // 04 · SUPPORTED INTEGRATIONS

- **ADS-B** — Ultrafeeder (local) or OpenSky Network (cloud fallback)
- **AIS** — AIS-catcher (local) or AISstream.io (cloud fallback)
- **P25** — OP25 trunked radio decoder (local SDR)
- **Mesh** — MeshCore node tracking over WebSocket
- **Weather** — NWS observations and alert zones
- **Traffic** — ODOT TripCheck incidents and camera streams
- **Alerts** — FlashAlert and county emergency management RSS

## // 05 · DOCUMENTATION

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, configuration, first run |
| [Architecture Overview](docs/architecture/overview.md) | Service layout and data flow |
| [Feature Overview](docs/features/overview.md) | Dashboard features and panels |
| [Environment Config](docs/configuration/environment.md) | `.env` variable reference |
| [Source Config](docs/configuration/sources.md) | `sources.yml` reference |

## // 06 · LICENSE

GPL-3.0 — see [LICENSE](LICENSE).
