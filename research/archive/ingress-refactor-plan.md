# Vertex Ingress Node Refactor

## Overview

Pivot away from Vertex-owned SDR containers toward a local ingress node model.
Vertex polls pre-existing SDR nodes on the local network and normalizes their
output through a shared config layer. A mounted YAML file (`config/sources.yml`)
becomes the single durable source of truth for all data sources and feeds.

### Key Goals

- Drop `--profile sdr` containers (ultrafeeder, op25, audio-bridge, icecast, meshcore)
- Replace hardcoded source URLs in pollers with DB-backed, YAML-seeded config
- Hot-reload sources without container restart
- Support multiple external Icecast streams (Broadcastify, local op25, etc.)
- Keep `.env` focused on infrastructure/credentials only

### Source Tagging

Every configurable source entry carries a `source` field:
- `config` — authored in `sources.yml`, managed by file edits
- `user` — created via the UI/API, written back to `sources.yml` for durability

YAML sync is only authoritative over `source=config` entries. `source=user`
entries survive all resyncs and are written back to the YAML on creation so
they survive database wipes.

---

## Progress

### Phase 1 — Foundation
- [x] `research/ingress-refactor-plan.md` — this file
- [x] `db/init/03_sources.sql` — 4 new tables
- [x] ORM models in `backend/db/models.py` — RadioStream, NewsFeed, PollerSource, AlertZoneConfig
- [x] `config/sources.yml` — initial populated config
- [x] `config/sources.example.yml` — documented template
- [x] `poller/config_loader.py` — Pydantic YAML parser
- [x] `backend/config_loader.py` — mirrored Pydantic YAML parser
- [x] `pyyaml` added to both requirements files

### Phase 2 — Config Watcher + DB Seed
- [x] `poller/config_sync.py` — diff-and-sync logic
- [x] `poller/config_watcher.py` — async mtime watcher task
- [x] Wire watcher + initial seed into `poller/main.py`
- [x] Expose `get_pool()` from `poller/db.py`

### Phase 3 — Poller Refactor
- [x] `poller/pollers/adsb.py` — load URLs from DB via `setup()`
- [x] `poller/pollers/p25.py` — remove module-level `_OP25_BASE` capture
- [x] `poller/pollers/ais.py` — load URLs from DB, fix dead `setup()` in `run()` override
- [x] `poller/pollers/meshcore.py` — load URLs from DB, fix dead `setup()` in `run()` override

### Phase 4 — Write-Back API
- [x] `backend/config_writer.py` — asyncio-locked YAML write operations
- [x] Extend `backend/routers/radio.py` — streams CRUD + write-back
- [x] Create `backend/routers/sources.py` — poller_sources + news_feeds + alert_zones CRUD
- [x] Register new router in `backend/main.py`
- [x] Updated `poller/config_sync.py` — source=user entries in YAML now recovered on DB wipe

### Phase 5 — News Feeds + Alert Zones
- [x] `poller/pollers/news.py` — loads RSS sources from DB via `setup()`; static tactical links remain hardcoded
- [x] `poller/pollers/alerts.py` — `setup()` queries `alert_zone_configs`; falls back to `NWS_ALERT_ZONES` env if table empty
- [x] `config/sources.yml` — seeded with 4 default RSS news feeds

### Phase 6 — Frontend Radio Panel
- [x] `frontend/src/hooks/useRadioStreams.ts` — fetches stream list from `/api/v1/radio/streams`
- [x] `frontend/src/components/panels/TacticalAudio.tsx` — CHANNELS drawer now tabbed (STREAMS / TALKGROUPS); stream selection swaps audio src live; `STREAM_URL` kept as build-time fallback

### Phase 7 — SDR Container Removal
- [x] Removed ultrafeeder, op25, audio-bridge, icecast, meshcore from `docker-compose.yml`
- [x] Removed `--profile sdr` concept entirely
- [x] Added `./config:/config` volume mount — rw for backend, ro for poller
- [x] Removed all SDR-related env vars from compose service blocks (ICECAST_URL, OP25_URL, ADSB_URL, AIS_CATCHER_URL, MESHCORE_URL, RADIO_STREAM_URL, VITE_STREAM_URL)
- [x] Removed ultrafeeder_conf named volume

### Phase 8 — .env Cleanup
- [x] `backend/config.py` — removed `radio_stream_url`, `icecast_url`, `op25_url`, `adsb_url`
- [x] `poller/config.py` — removed `adsb_url`, `ais_catcher_url`, `op25_url`, `icecast_url`, `meshcore_url`; `nws_alert_zones` kept as documented fallback; `aisstream_api_key` kept as cloud fallback

---

## Architecture

### Data Flow (Post-Refactor)

```
config/sources.yml (host file)
        │
        │  mount (ro: poller, rw: backend)
        ▼
┌───────────────────────────────────┐
│  poller/config_watcher.py         │
│  polls mtime every 5s             │
│  calls config_sync on change      │
└──────────────┬────────────────────┘
               │ sync_sources_to_db()
               ▼
         PostgreSQL
    (radio_streams, news_feeds,
     poller_sources, alert_zone_configs)
               │
    ┌──────────┴───────────┐
    │                      │
    ▼                      ▼
Pollers              Backend API
(read urls          (CRUD endpoints
 from DB at          write-back to
 setup())            sources.yml)
    │                      │
    └──────────┬───────────┘
               ▼
             Redis
               ▼
           Frontend
```

### YAML Schema

```yaml
radio_streams:
  - name: "P25 Tactical"
    url: "http://icecast-host:8000/radio.mp3"
    format: mp3          # mp3 | ogg | aac
    enabled: true
    source: config

news_feeds:
  - name: "KOIN 6 Local"
    url: "https://www.koin.com/feed"
    format: rss          # rss | atom | flashalert_xml | static
    enabled: true
    source: config

poller_sources:
  - type: adsb           # adsb | ais | p25 | meshcore
    name: "Primary ADS-B"
    url: "http://192.168.1.x:8080/data/aircraft.json"
    enabled: true
    source: config

alert_zones:
  nws_zones:
    - "ORZ006"
    - "ORZ005"
    - "ORZ007"
  source: config
```

### .env Responsibilities (Post-Refactor)

**Stays in .env** — infrastructure and credentials:
- `DATABASE_URL`, `REDIS_URL`, `POSTGRES_*`
- All external API keys (`ODOT_API_KEY`, `AIRNOW_API_KEY`, `AISSTREAM_API_KEY`)
- `REGION_LAT/LON/ALT/NAME`, `BBOX_*`
- `AUTH_*`, `LOG_LEVEL`
- `NWS_STATION_PRIMARY/SECONDARY` (weather station obs, not alert zones)
- `SUMMARY_LLM_*`

**Moves to sources.yml** — data sources and feeds:
- All poller source URLs
- Radio stream URLs
- News feed URLs
- NWS alert zones

---

## Gotchas

1. **Module-level settings capture** — `_OP25_BASE = settings.op25_url` in `p25.py`
   is captured at import time. All source URL reads must move into `setup()`.

2. **Streaming pollers override `run()`** — `AisPoller` and `MeshCorePoller` bypass
   `BasePoller.run()` so `setup()` is currently dead code for them. Phase 3 must
   call `await self.setup()` at the top of their `run()` override.

3. **Config dir must exist before container starts** — `config_loader.py` returns an
   empty `SourcesConfig` gracefully if the file is missing, preventing startup failure.

4. **Duplicate config_loader.py** — backend and poller have separate filesystems.
   The module is identical in both; keep them in sync manually or via CI check.

5. **asyncio.Lock for write-back** — sufficient for single uvicorn worker. If
   multi-worker is ever added, replace with `fcntl.flock`.

6. **AISstream fallback stays in .env** — uses an API key, not a URL from
   sources.yml. Intentional hybrid: `poller_sources WHERE type='ais'` first,
   then `settings.aisstream_api_key` as cloud fallback.
