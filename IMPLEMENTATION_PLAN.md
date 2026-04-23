# Vertex — Master Implementation Plan

## Project Vision

Vertex is a local-first, real-time situational awareness dashboard for the Tualatin/Portland
metro area. It fuses aviation, maritime, weather, traffic, and emergency alert data into a single
map-centric interface. The system runs on a Raspberry Pi 5 and supports both ARM64 and x86_64.

---

## Container Architecture

Five containers — minimal footprint, maximum modularity:

| Container  | Role                                  | Base Image                        |
|------------|---------------------------------------|-----------------------------------|
| `db`       | PostgreSQL 16 + PostGIS               | `postgis/postgis:16-3.4-alpine`   |
| `redis`    | Hot state cache + pub/sub event bus   | `redis:7-alpine`                  |
| `backend`  | FastAPI REST + WebSocket API          | `python:3.12-slim`                |
| `poller`   | All background data pollers           | `python:3.12-slim`                |
| `frontend` | React/MapLibre UI served by Nginx     | `nginx:alpine` (multi-stage)      |

All base images carry native `linux/amd64` and `linux/arm64` manifests — no emulation on Pi 5.

---

## Directory Structure

```
vertex/
├── docker-compose.yml
├── .env.example
├── IMPLEMENTATION_PLAN.md
│
├── backend/                      # FastAPI REST + WebSocket server
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                   # App entry, router registration, lifespan
│   ├── config.py                 # Pydantic settings (env vars)
│   ├── deps.py                   # DI: db session, redis client
│   ├── redis_bus.py              # Redis helpers (get/set entity, pub/sub)
│   ├── db/
│   │   ├── session.py            # SQLAlchemy async engine + Base
│   │   └── models.py             # Entity, Observation, Event, Geofence
│   ├── routers/
│   │   ├── entities.py           # GET /api/v1/entities[/{id}]
│   │   ├── observations.py       # GET /api/v1/entities/{id}/trail
│   │   ├── events.py             # GET /api/v1/events
│   │   ├── weather.py            # GET /api/v1/weather[/alerts]
│   │   ├── alerts.py             # GET /api/v1/alerts
│   │   ├── traffic.py            # GET /api/v1/traffic/incidents|cameras
│   │   ├── health.py             # GET /health
│   │   └── ws.py                 # WS  /ws  (live entity + alert stream)
│   └── schemas/
│       ├── entity.py
│       ├── observation.py
│       └── event.py
│
├── poller/                       # Background polling workers (single container)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                   # asyncio task runner — launches all pollers
│   ├── config.py                 # Pydantic settings
│   ├── bus.py                    # Redis publisher helpers
│   ├── pollers/
│   │   ├── base.py               # BasePoller ABC (run loop + error handling)
│   │   ├── adsb.py               # Aircraft: Ultrafeeder (local) / OpenSky (public)
│   │   ├── ais.py                # Vessels: AIS-catcher (local) / AISstream.io (public)
│   │   ├── weather.py            # NWS api.weather.gov (free, no key)
│   │   ├── alerts.py             # RSS: FlashAlert, WashCo EM, City of Tualatin
│   │   └── traffic.py            # ODOT TripCheck RSS (free, public)
│   └── normalizers/
│       ├── aircraft.py           # OpenSky state[] / tar1090 JSON → canonical Entity dict
│       ├── vessel.py             # AISstream.io / AIS-catcher JSON → canonical Entity dict
│       └── weather.py            # NWS JSON → flat weather dict
│
├── frontend/                     # React + MapLibre GL
│   ├── Dockerfile                # Multi-stage: node:20-alpine build → nginx:alpine serve
│   ├── nginx.conf                # Serve static + proxy /api/* and /ws to backend
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── config.ts             # API base URL, WS URL, map defaults
│       ├── store.ts              # Zustand global state
│       ├── components/
│       │   ├── Map.tsx           # MapLibre root, initializes layers
│       │   ├── layers/
│       │   │   ├── AircraftLayer.tsx
│       │   │   └── VesselLayer.tsx
│       │   └── panels/
│       │       ├── AlertBanner.tsx
│       │       ├── StatusBar.tsx
│       │       └── EntityDetail.tsx
│       └── hooks/
│           ├── useWebSocket.ts   # WS lifecycle, message dispatch, auto-reconnect
│           └── useEntities.ts    # Selector: entities filtered by type
│
├── db/
│   └── init/
│       ├── 01_schema.sql         # Tables, indexes, PostGIS, purge function
│       └── 02_geofences.sql      # Portland metro seed zones
│
└── infra/
    └── redis/
        └── redis.conf
```

---

## Data Flow

```
External APIs / Local SDR
        │
   [poller container]
   ├── adsb.py    (5s)  → normalize → Redis  entity:{id}  +  pub civic:updates
   ├── ais.py     (ws)  → normalize → Redis  entity:{id}  +  pub civic:updates
   ├── weather.py (5m)  → normalize → Redis  feed:weather:current / feed:weather:alerts
   ├── alerts.py  (60s) → parse RSS → Redis  feed:alerts:flash
   └── traffic.py (30s) → parse RSS → Redis  feed:traffic:incidents
        │
   [backend container]  — reads Redis, writes Postgres on entity upserts
   ├── WS  /ws                        → Redis pub/sub → browser clients
   ├── GET /api/v1/entities           → Redis keys entity:*
   ├── GET /api/v1/entities/{id}/trail → Postgres observations
   ├── GET /api/v1/weather            → Redis feed:weather:current
   ├── GET /api/v1/alerts             → Redis feed:alerts:flash
   └── GET /api/v1/traffic/incidents  → Redis feed:traffic:incidents
        │
   [frontend container]
   └── Nginx serves React build, proxies /api/* + /ws to backend
```

---

## Public Data Sources (Free, No Subscription Required)

| Feed                  | URL / Service                               | Auth      | Interval  |
|-----------------------|---------------------------------------------|-----------|-----------|
| Aircraft positions    | OpenSky Network `opensky-network.org/api`   | None      | 5 s       |
| Aircraft (local)      | Ultrafeeder tar1090 JSON (self-hosted)      | None      | 5 s       |
| Vessel tracking       | AISstream.io free tier (WebSocket)          | Free key  | WS stream |
| Vessel (local)        | AIS-catcher WebSocket (self-hosted)         | None      | WS stream |
| Weather observations  | NWS `api.weather.gov` KHIO / KUAO stations  | None      | 5 min     |
| Weather alerts        | NWS alerts API `?zone=ORZ006`               | None      | 5 min     |
| Traffic incidents     | ODOT TripCheck RSS                          | None      | 30 s      |
| Emergency alerts      | FlashAlert RSS (Portland-Longview-Salem)    | None      | 60 s      |
| County alerts         | Washington County EM RSS                    | None      | 60 s      |
| City news             | City of Tualatin RSS                        | None      | 60 s      |

---

## Canonical Entity Model

Every trackable thing (aircraft, vessel, mesh node, sensor) becomes an `Entity` dict published
to Redis and an `entities` row in Postgres.  Position history lives in `observations`.

```
Entity
  entity_id     str   "aircraft:a1b2c3"
  entity_type   str   "aircraft" | "vessel" | "sensor" | "mesh_node"
  source        str   "opensky" | "ultrafeeder" | "aisstream" | "ais-catcher"
  display_name  str   callsign / vessel name / node name
  identity      dict  {icao24, callsign, squawk} or {mmsi, ship_name, ...}
  lat / lon     float current position
  altitude      float feet (aircraft) or null
  heading       float degrees true
  speed         float knots
  status        str   "airborne" | "on_ground" | navigation status code
  last_seen     str   ISO-8601 UTC timestamp
  tags          list  ["aircraft"] | ["vessel"] | ...

Observation  (Postgres, time-series, 30-day retention)
  entity_id, ts, lat, lon, altitude, heading, speed, vertical_rate,
  status, signal_quality, raw_payload, geom GEOMETRY(POINT,4326)

Event  (Postgres)
  event_id, event_type, entity_id, ts, severity, summary, details
  e.g. type="geofence_entry", severity="warning", summary="N12345 entered PDX Zone"

Geofence  (Postgres + PostGIS)
  id, name, description, zone_type, geom GEOMETRY(POLYGON,4326), active
```

---

## Implementation Milestones

### M1 — Core Infrastructure (this commit)
- [x] Docker Compose 5-container stack
- [x] PostgreSQL + PostGIS schema with indexes
- [x] Redis bus with entity state + pub/sub
- [x] FastAPI backend skeleton (REST + WebSocket)
- [x] Poller framework with BasePoller ABC
- [x] React + MapLibre GL frontend skeleton
- [x] Portland metro geofence seeds

### M2 — First Live Feed: Aircraft
- [ ] OpenSky poller returning aircraft for Portland metro bbox
- [ ] Aircraft visible on map as dots with callsign tooltip
- [ ] 30-minute trail stored in Postgres observations
- [ ] WebSocket push working end-to-end in browser
- [ ] StatusBar showing live aircraft count

### M3 — Weather & Emergency Alerts
- [ ] NWS weather poller for KHIO/KUAO stations
- [ ] Active weather alerts displayed in AlertBanner
- [ ] FlashAlert + WashCo EM RSS feeds parsing
- [ ] ODOT TripCheck incident feed active

### M4 — Maritime & Geofences
- [ ] AIS vessel layer (AISstream.io free tier)
- [ ] Vessels on Willamette + Columbia rivers on map
- [ ] Geofence entry/exit events written to Postgres
- [ ] Alert engine: browser push on geofence event

### M5 — SDR Hardware Integration
- [ ] Ultrafeeder container in docker-compose (optional profile)
- [ ] AIS-catcher container in docker-compose (optional profile)
- [ ] Automatic fallback: local SDR → public API when offline
- [ ] OP25 P25 audio stream via Icecast (Washington County / Tualatin PD+Fire)
- [ ] Meshtastic MQTT collector

### M6 — Production Hardening
- [ ] Observation retention cleanup (30-day purge cron)
- [ ] Prometheus metrics endpoint from backend
- [ ] Cloudflare Tunnel or Caddy for secure remote access
- [ ] Basic auth / OIDC proxy layer
- [ ] AI summary worker (incident narrative from fused feeds)

---

## Raspberry Pi 5 Deployment Notes

- **RAM budget**: redis ~50MB, postgres ~150MB, backend ~200MB, poller ~100MB, nginx ~20MB ≈ 520MB idle
- **Storage**: Mount db_data and redis_data volumes on SSD (not SD card) for write endurance
- **USB SDRs**: Assign serial numbers with `rtl_eeprom -s NNNN` before first use; reference by serial
  in container env vars to prevent device conflicts across multiple dongles
- **tmpfs**: Ultrafeeder uses tmpfs for high-frequency JSON state files to protect flash storage
- **Cross-compile**: `docker buildx build --platform linux/arm64` from an x86 dev machine for fast builds
- **Networking**: All containers on `internal` bridge; only port 80 (frontend) exposed to LAN
