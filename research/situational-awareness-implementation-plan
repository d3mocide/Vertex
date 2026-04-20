# Situational Awareness Dashboard Architecture

## Overview

This document defines a local-first architecture for a situational awareness dashboard that fuses multiple self-hosted feeds into one map-centric interface. The design assumes an existing ADS-B Ultrafeeder deployment as the first production source, with future expansion to AIS-catcher, Meshtastic MQTT, local weather, and host/system telemetry feeds.[1][2][3][4]

The architecture is intentionally non-invasive: existing feeders continue operating independently, while the dashboard stack consumes their local outputs as sidecar services. This reduces operational risk and lets new feeds be added without disrupting the decode/share workflows already in place.[1][2]

## Architectural Principles

The system should follow five core principles:

- Non-invasive integration, so existing feeders remain functional if the dashboard stack is offline.[1][2]
- Source-agnostic normalization, so aircraft, vessels, mesh nodes, and sensors can all be represented through a common event model.[5][4]
- Local-first transport, preferring LAN endpoints, local brokers, and local storage over cloud APIs where possible.[1][3][4]
- Map-first presentation, because geography is the most useful organizing surface for live radio, transport, and telemetry feeds.[2]
- Replaceable adapters, allowing each source collector to change independently without forcing schema or UI rewrites.[3][4]

## Layered Design

The recommended design has five layers.

### Source Layer

The source layer contains feed producers such as Ultrafeeder, AIS-catcher, Meshtastic MQTT, local weather sensors, and host telemetry exporters. Ultrafeeder already bundles readsb, tar1090, and graphs1090, which makes it a strong first source for live aircraft state and feeder-health metrics.[1][2]

AIS-catcher supports multiple emission patterns including JSON-oriented outputs and network transports such as HTTP, TCP, MQTT, and ZMQ, making it suitable for push- or pull-based collection. Meshtastic can expose network traffic through MQTT, which is a useful path for node status, telemetry, and message activity ingestion.[3][5][4]

### Collector Layer

Each collector is a narrow adapter that reads one source and emits normalized observations and events. Initial collectors should include `collector-adsb`, `collector-ais`, `collector-meshtastic`, and `collector-weather`.[1][3][4]

Collectors should be stateless where possible and should avoid embedding business rules such as geofence alerts or anomaly detection. Their job is to parse source-native payloads, validate them, enrich only lightly, and publish canonical messages to the internal bus.[3][5][4]

### State and History Layer

The state layer should keep a fast representation of the current world state, while the history layer stores durable movement and telemetry records. Redis is a good fit for live entity state and fanout, while Postgres with PostGIS is the right durable store for trails, zones, replay, and spatial queries.[6][7]

This split matters because live moving-entity updates should not force the UI to query the durable database on every change. The hot path should serve low-latency current state, while the cold path preserves history for investigations, playback, and analytics.[2][6]

### Rules and Enrichment Layer

Rules and enrichment should be separate workers, not embedded inside collectors. This layer should handle geofences, distance calculations, “near home” logic, reverse geocoding, metadata lookups, feed-health calculations, and anomaly scoring.[2][4]

Keeping this logic separate allows the platform to grow from a simple display into a true awareness system. It also ensures that expensive lookups or complex logic do not block ingestion of live packets and position updates.[2][4]

### Presentation Layer

The presentation layer should expose both REST and WebSocket interfaces to a map-first web application. The dashboard should emphasize live map layers, entity details, source health, and an event timeline rather than functioning as a generic chart dashboard.[2]

Tar1090 demonstrates the operational value of a dense aircraft map, while graphs1090 shows how feeder health and decoder metrics can be surfaced effectively. The dashboard should extend those strengths into a multi-source fusion console rather than replacing them with a chart-heavy UI.[2]

## Recommended Stack

| Layer | Technology | Role |
|---|---|---|
| API | FastAPI | REST, WebSocket, admin endpoints |
| Live state | Redis | Current entity cache, pub/sub, stream fanout |
| Durable history | Postgres + PostGIS | Trails, geofences, replay, analytics |
| Internal bus | Redis Streams | Simple event transport for MVP |
| Frontend | React + MapLibre GL | Map-first live dashboard |
| Background jobs | Python workers | Enrichment, alerts, cleanup |
| Deployment | Docker Compose | Local orchestration alongside feeders |

This stack is intentionally pragmatic. It supports strong local observability and geospatial workflows without introducing orchestration complexity too early.[1][2]

## Core Data Model

A shared entity model is the most important design choice in the system.

### Entity

An `Entity` represents a trackable thing such as an aircraft, vessel, mesh node, or sensor.

Suggested fields:

- `entity_id`
- `entity_type`
- `source`
- `display_name`
- `identity` (JSON)
- `tags`
- `first_seen`
- `last_seen`

### Observation

An `Observation` represents a time-stamped state update.

Suggested fields:

- `entity_id`
- `timestamp`
- `lat`
- `lon`
- `altitude`
- `heading`
- `speed`
- `vertical_rate`
- `status`
- `signal_quality`
- `raw_payload`

### Event

An `Event` represents something notable derived from one or more observations.

Suggested fields:

- `event_id`
- `event_type`
- `entity_id`
- `timestamp`
- `severity`
- `summary`
- `details`

This model supports aircraft, vessels, mesh nodes, and fixed sensors without needing a separate UI or transport pattern for each source.[5][4]

## Data Flow

The recommended data flow is:

1. A collector receives source-native data from a local feed.
2. The collector validates and normalizes it into canonical observations or events.
3. The normalized message is published to Redis Streams.
4. A state projector updates the current entity state in Redis.
5. A history writer batches records into Postgres/PostGIS.
6. An alert engine evaluates rules and emits derived events.
7. The WebSocket gateway pushes deltas to subscribed clients.

This approach separates low-latency state updates from durable storage and analytical processing, which improves responsiveness and operational resilience as more local feeds are added.[1][3][4]

## Service Topology

The initial deployment should be composed of the following services:

- `dashboard-api`
- `frontend`
- `redis`
- `postgres`
- `collector-adsb`
- `collector-ais`
- `collector-meshtastic`
- `collector-weather`
- `state-projector`
- `history-writer`
- `alert-engine`

Optional later services include:

- `enrichment-worker`
- `ai-summary-worker`
- `tile-cache`
- `auth-proxy`

This separation keeps collectors small, isolates failures, and makes it easy to scale specific paths like alerting or enrichment without redesigning the whole system.[1][3][4]

## Feed Integration Strategy

### ADS-B

Use Ultrafeeder as the first live source. Start with tar1090/readsb JSON outputs for a fast MVP, then consider Beast or SBS outputs if lower latency or deeper parser control becomes necessary.[1][2]

### AIS

Use AIS-catcher as the second source. Its JSON-oriented decoding and multiple network output options make it a strong fit for a local vessel collector and future maritime overlays.[3][5]

### Meshtastic

Use MQTT as the integration point for Meshtastic. This allows ingestion of node telemetry, packet activity, and position updates using a pattern similar to the other feed collectors.[4]

### Host and Weather Telemetry

Add local weather or host telemetry as sensor-style entities. This provides context for changes in traffic density, RF performance, and feed-health anomalies.

## API Surfaces

The platform should expose three interface patterns.

### REST API

Use REST for:

- Current entity queries
- Zone and geofence management
- History and replay queries
- Metrics snapshots
- Feed health summaries

### WebSocket API

Use WebSockets for:

- Live entity updates
- Alert notifications
- Feed status changes
- Layer and bounding-box subscriptions

### Ingest Endpoints

Use direct ingest endpoints for push-style local producers where useful, especially AIS-catcher HTTP or future local services that are easier to configure as webhooks than stream consumers.[3]

## Security Model

The platform should be private by default. Database and ingest ports should remain internal to the Docker network, while only the frontend and, if needed, the API should be exposed through a reverse proxy.

Authentication can be deferred for a LAN-only MVP, but the design should assume future addition of basic auth, OIDC, or another lightweight access control layer. This is especially important if the dashboard begins aggregating multiple sensitive local feeds into one view.

## Operations and Observability

The dashboard itself should be observable.

Minimum health and operations features should include:

- Per-collector health checks
- Queue lag visibility
- Source silent-time detection
- Message-rate metrics
- Structured logs for parse failures and malformed payloads
- Basic retention and cleanup jobs

This is especially important because the platform is intended to become a sensor-fusion tool, and feed quality is as important as the tracked entities themselves.[2]

## Recommended First Milestone

The first production milestone should be narrowly scoped:

**A local map that displays live aircraft from Ultrafeeder, stores 30 minutes of trails, exposes a WebSocket stream, and raises an alert when an aircraft enters a geofence.**[1][2]

That milestone proves the most important architectural decisions: collector isolation, canonical events, live state projection, history storage, and alert generation. Once that works, AIS, Meshtastic, and additional sensor feeds can be added with much lower risk.[3][4]
