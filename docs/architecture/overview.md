# Architecture Overview

Vertex is a local-first situational awareness stack built around five cooperating services.

## Service Layout

| Service | Purpose | Main Entry Point |
|---------|---------|------------------|
| `db` | PostgreSQL 16 with PostGIS for persistent entities, observations, events, and geofences | `db/init/` |
| `redis` | Hot state cache and pub/sub bus for live updates | `infra/redis/redis.conf` |
| `backend` | FastAPI REST and WebSocket API | `backend/main.py` |
| `poller` | Async ingestion and normalization workers | `poller/main.py` |
| `frontend` | React, Deck.gl, and MapLibre client served by Nginx | `frontend/src/main.tsx` |

## Core Data Flow

```text
external APIs and local sensors
        -> poller
        -> PostgreSQL
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

## Poller Responsibilities

The poller is the ingestion engine. It connects to local devices, remote APIs, and feed endpoints, normalizes payloads, persists data, and publishes real-time updates.

Current poller coverage includes:

- ADS-B aircraft
- AIS vessels
- APRS stations
- weather conditions and alerts
- traffic incidents, cameras, and flow
- wildfire activity
- news and emergency alert feeds
- P25 metadata
- MeshCore updates
- seismic events
- summary generation

## Frontend Responsibilities

The frontend consumes REST snapshots plus live WebSocket events, stores them in Zustand, and renders them through Deck.gl and MapLibre.

High-level flow:

1. REST endpoints hydrate initial state.
2. `/ws` pushes incremental updates.
3. Zustand stores merge and normalize feed data.
4. Deck.gl layer builders render entities, trails, overlays, and UI panels.

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

## Operational Notes

- The frontend build is strict TypeScript and will fail on type errors.
- The poller and backend both rely on async I/O throughout.
- Docker Compose is the intended local orchestration path for development and deployment.

For deployment setup, see [Getting Started](../getting-started.md). For feature-level behavior, see [Feature Overview](../features/overview.md).