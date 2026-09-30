# Architecture Overview

Vertex is a local-first situational awareness stack built around seven cooperating services.

## Service Layout

| Service | Purpose | Main Entry Point |
|---------|---------|------------------|
| `db` | PostgreSQL 16 with PostGIS for persistent entities, observations, events, and geofences | `db/init/` |
| `redis` | Hot state cache and pub/sub bus for live updates | `infra/redis/redis.conf` |
| `mosquitto` | MQTT broker for IoT sensors (rtl_433, Meshtastic, AIS-catcher) | `infra/mosquitto/mosquitto.conf` |
| `backend` | FastAPI REST and WebSocket API | `backend/main.py` |
| `poller` | Async ingestion and normalization workers | `poller/main.py` |
| `transcription` | Speech-to-text service for recorded radio calls | `transcription/main.py` |
| `frontend` | React, Deck.gl, and MapLibre client served by Nginx | `frontend/src/main.tsx` |

## Core Data Flow

```text
external APIs and local sensors
        -> poller (an async worker per source)
        -> PostgreSQL + PostGIS
        -> Redis pub/sub
        -> backend WebSocket and REST
        -> frontend store and map layers
```

## Backend Responsibilities

The backend exposes REST endpoints under `/api/v1/` and a live WebSocket at `/ws`.

Major surfaces include:

- entities and observations
- events and geofences
- weather, alerts, news, and traffic
- radio metadata and dynamic source configuration
- authentication and admin flows
- outbound alert rule and webhook handling
- Prometheus metrics endpoint
- admin health console (`/admin/overview`: what needs attention, service status for PostgreSQL, Redis, the API, pollers, the AI briefing and the ADS-B receiver, and freshness of every data source against its expected interval; plus poller heartbeats, ingestion rates, entity activity, signal quality, storage and purge health, connection pool, squawk counters, talkgroup activity and data completeness)

## Poller Responsibilities

The poller is the ingestion engine. It connects to local devices, remote APIs, and feed endpoints, normalizes payloads, persists data, and publishes real-time updates.

Current poller coverage (one async worker per source; the list below groups them):

| Poller | Source |
|--------|--------|
| ADS-B | Local BEAST receiver (primary), tar1090 JSON standby, airplanes.live / adsb.fi community feeds, OpenSky gap-filler; aircraft roles from registration and owner data |
| AIS | Local AIS-catcher WebSocket or AISstream.io cloud fallback |
| APRS | APRS-IS network |
| Weather | NWS observations, alerts, METAR/TAF, PIREPs/SIGMETs, NWWS text products, AirNow AQI, Wunderground PWS, NOAA GOES WMS |
| Traffic and infrastructure | ODOT TripCheck incidents, cameras, flow, freeway corridors, message signs; Oregon ODIN power outages with weather/lightning context |
| Fire and hazards | USFS/USGS fire points, NIFC/WFIGS perimeters, NASA FIRMS hotspots, ODF fire danger, lightning strikes |
| News | Aggregated RSS and Atom feeds |
| Alerts | FlashAlert, NWS CAP, county RSS |
| P25 | OP25 metadata, per-call audio recorder (`p25_recorder`), and radio incident extraction |
| Transit | Amtrak, TriMet GTFS-RT |
| MeshCore | MeshCore bridge WebSocket |
| Seismic | USGS earthquake feed |
| GDACS | Global Disaster Alert and Coordination System GeoRSS |
| AI Summary | LiteLLM-compatible situational briefings built from events, radio, news and NWS products |
| Anomaly Detection | Sigma-threshold anomaly alerting on telemetry streams |

TinyGS satellite ground station ingestion is available as an optional worker enabled via `TINYGS_ENABLED`.

## How Aircraft Sources Are Merged

Each aircraft has one live position. The poller picks the best source per aircraft:

1. local BEAST receiver (highest priority, instant),
2. local tar1090 JSON, polled only while BEAST is silent,
3. community feeds (airplanes.live / adsb.fi), roughly 0.3 s old,
4. OpenSky, which only supplies aircraft the sources above missed.

A position with an older timestamp never replaces a newer one, so icons never jump backwards when a slower source reports late.

## Frontend Responsibilities

The frontend consumes REST snapshots plus live WebSocket events, stores them in Zustand, and renders them through Deck.gl and MapLibre.

High-level flow:

1. REST endpoints hydrate initial state.
2. `/ws` pushes incremental updates.
3. Zustand stores merge and normalize feed data.
4. Deck.gl layer builders render entities, trails, overlays, and UI panels.

Key layer builders:

- entity layer (aircraft, vessels, APRS, hazard icons)
- trail and history layers
- lightning, stream gauge, mesh node, and camera layers
- fire perimeter polygon overlay (NIFC)
- GOES satellite raster tile overlay
- seismic event scatter layer
- custom KML / GeoJSON layers

## Configuration Boundaries

Configuration is split intentionally:

- `.env` controls infrastructure addresses, region geometry, credentials, feature behavior, and optional analytics/auth settings
- `config/sources.yml` defines user-editable feed and source endpoints

This split keeps sensitive credentials and deployment parameters separate from higher-level source inventories.

## Persistence Model

PostgreSQL stores durable records such as:

- current entities
- historical observations
- event history
- geofence definitions
- user-managed source and alert rule records

Redis is used for:

- live entity and event fan-out
- hot feed cache snapshots
- inter-service publish/subscribe

## Optional Compose Profiles

| Profile | What it adds |
|---------|-------------|
| `monitoring` | Grafana + Prometheus for dashboards and metrics |
| `offline` | tileserver-gl for local raster map tile serving |

## Operational Notes

- The frontend build is strict TypeScript and will fail on type errors.
- The poller and backend both rely on async I/O throughout.
- Docker Compose is the intended local orchestration path for development and deployment.

For deployment setup, see [Getting Started](../getting-started.md). For feature-level behavior, see [Feature Overview](../features/overview.md).
