// Embedded documentation content. Update alongside /docs/ when docs change.

export interface DocPage {
  id: string
  title: string
  content: string
  section: string
}

const gettingStarted = `# Getting Started

This guide covers the shortest path to a working local Vertex deployment.

## Prerequisites

- Docker Desktop or Docker Engine with Compose support
- An x86_64 or ARM64 host
- A writable checkout of this repository

Optional but common:

- Local ADS-B source such as Ultrafeeder or tar1090
- Local AIS source such as AIS-catcher
- Local OP25 endpoint for P25 metadata and audio

## First Run

1. Copy the environment template.
2. Copy the example source configuration.
3. Fill in any API keys or local endpoint URLs you plan to use.
4. Start the stack.

\`\`\`bash
cp .env.example .env
cp config/sources.example.yml config/sources.yml
docker compose up -d
\`\`\`

Open \`http://localhost\` after the containers are healthy.

## Minimum Setup Checklist

Vertex will boot without every optional integration being configured, but a useful deployment usually needs at least:

- Regional coordinates and bounding box in \`.env\`
- One or more enabled feeds in \`config/sources.yml\`
- \`ODOT_API_KEY\` if you want TripCheck traffic data
- \`AIRNOW_API_KEY\` if you want AQI data
- \`AISSTREAM_API_KEY\` only when you are using AISstream instead of a local AIS feed

## Local-First Configuration Model

Vertex has two main configuration surfaces:

- \`.env\` for infrastructure, region, feature toggles, and API credentials
- \`config/sources.yml\` for editable source definitions such as radio streams, news feeds, alert feeds, and local poller endpoints

The source file is hot-reloaded by the poller and can also be updated through the UI for user-managed sources.

## Typical Bring-Up Flow

### 1. Set the region

Update the region center, region name, and bounding box in \`.env\` so feeds are filtered for your area.

### 2. Add source endpoints

Edit \`config/sources.yml\` to point Vertex at your local or preferred remote sources.

Examples:

- ADS-B JSON feed from tar1090 or Ultrafeeder
- AIS WebSocket from AIS-catcher
- OP25 endpoint and audio stream
- Local or regional RSS feeds for alerts and news

### 3. Start services

\`\`\`bash
docker compose up -d
docker compose logs -f backend
docker compose logs -f poller
\`\`\`

### 4. Verify the UI

Check that:

- the map loads
- entities appear for enabled feeds
- side panels populate with weather, traffic, alerts, or radio content
- live updates continue through the WebSocket connection

## Development Validation

\`\`\`bash
cd frontend && npx tsc --noEmit
docker compose config --quiet
python3 -m py_compile backend/main.py poller/main.py
\`\`\`
`

const featuresOverview = `# Feature Overview

This page summarizes the major capability areas currently implemented in Vertex.

## Situational Map

The map is the primary operating surface.

Current map-oriented capabilities include:

- live aircraft, vessel, APRS, wildfire, and mesh node rendering
- track and trail visualization for moving entities
- fire perimeter polygon overlay (NIFC/WFIGS)
- NOAA GOES satellite imagery tiles (IR and visible, via nowCOAST WMS)
- seismic event markers rendered as a Deck.gl scatter layer
- smoke and radar overlays for environmental context
- region-aware filtering using configured bounding boxes
- KML and GeoJSON custom layer import
- searchable entity detail with enrichment fields where available

## Transportation and Mobility

### Aircraft

- Local ADS-B JSON ingest from tar1090 / Ultrafeeder
- BEAST TCP transport for live decoder integration with CPR decode and trail smoothing
- OpenSky supplemental polling (optional, configurable interval)
- aircraft metadata enrichment, route context, airport and navaid references
- squawk emergency highlighting (7500, 7600, 7700) with color-coded alerts
- observation history persistence for trails, playback, and analysis

### Marine

- AISstream.io cloud fallback or local AIS WebSocket ingest (AIS-catcher)
- vessel normalization with navigational status color coding
- live map rendering with vessel detail panel

### Amateur and Community RF

- APRS-IS ingest for radio and community station tracking
- MeshCore endpoint support for mesh node awareness and battery/SNR display
- TinyGS satellite ground station integration (optional)

## Weather and Environment

- NWS observations and weather alerts with zone-based filtering
- Aviation weather: METAR and TAF with flight category color coding
- Aviation hazards: PIREPs, SIGMETs, and AIRMETs
- NWS text products: AFD, HWO, LSR via the National Weather Wire Service feed
- Personal Weather Stations via Wunderground API
- AirNow AQI integration
- NOAA GOES satellite imagery tiles (IR / visible toggle in Settings)
- wildfire ingest with local versus regional relevance handling
- NIFC fire perimeter polygons (WFIGS GeoJSON, refreshed every 30 minutes)
- smoke overlay support and environment panel wildfire status
- stream gauge stage and discharge (cfs) from USGS
- seismic event ingestion with depth display and live event panel updates
- GDACS global disaster alerts via GeoRSS with distance-based severity gating

## Traffic and Infrastructure

- ODOT TripCheck incidents
- traffic camera feeds with health monitoring
- traffic flow corridor monitoring
- region-scoped incident filtering and incident detail rendering

## Alerts and Community Context

- FlashAlert and emergency RSS feeds
- local and regional news feeds
- GDACS disaster alerts
- system event history
- AI-generated situation summaries when \`SUMMARY_LLM_MODEL\` is configured

## Radio and Audio

- live tactical audio streams from configurable sources
- P25 metadata ingest for channel and call activity context
- talkgroup management UI for name, priority, and scan list configuration
- configurable remote stream URLs managed through source configuration

## Geofencing and Automation

- polygon and circle geofences with dwell-based triggering
- event history for entry and exit conditions
- outbound alert rules and webhook dispatching
- Cursor-on-Target (CoT) UDP multicast output for TAK / ATAK integration
- optional CoT receive mode for ingesting external CoT feeds

## TAK / Cursor-on-Target

- CoT emitter sends entity positions as CoT UDP multicast on a configurable address and port
- TAK Server TCP output supported (\`COT_TAKSERVER_HOST\`)
- CoT receive mode allows ingest of external CoT position reports

## SitRep and Export

- Markdown SitRep export covering a configurable time window
- exports the live event timeline, active alerts, and entity summary

## AI Anomaly Detection

- optional background anomaly detection on ingested telemetry
- sigma-threshold based alerting with configurable window and sensitivity
- enabled via \`ANOMALY_ENABLED\`, tuned with \`ANOMALY_WINDOW_MINUTES\` and \`ANOMALY_SIGMA_THRESHOLD\`

## Replay and Playback

- historical entity playback via \`/observations/replay\`
- absolute date and time range mode with a custom date picker
- playback timeline with event markers

## Admin and Security

- optional JWT authentication with configurable token lifetime
- viewer role for read-only access
- admin metrics dashboard: per-poller ingestion rates, error counts, signal quality, entity freshness, squawk counters, P25 talkgroup activity, mesh battery distribution, and data completeness scorecard
- runtime-editable source definitions via the UI
- rate limiting and Prometheus metrics endpoint
`

const architectureOverview = `# Architecture Overview

Vertex is a local-first situational awareness stack built around five cooperating services.

## Service Layout

| Service | Purpose | Main Entry Point |
|---------|---------|------------------|
| \`db\` | PostgreSQL 16 with PostGIS for persistent entities, observations, events, and geofences | \`db/init/\` |
| \`redis\` | Hot state cache and pub/sub bus for live updates | \`infra/redis/redis.conf\` |
| \`backend\` | FastAPI REST and WebSocket API | \`backend/main.py\` |
| \`poller\` | Async ingestion and normalization workers | \`poller/main.py\` |
| \`frontend\` | React, Deck.gl, and MapLibre client served by Nginx | \`frontend/src/main.tsx\` |

## Core Data Flow

\`\`\`
external APIs and local sensors
        -> poller (14 async workers)
        -> PostgreSQL + PostGIS
        -> Redis pub/sub
        -> backend WebSocket and REST
        -> frontend store and map layers
\`\`\`

## Poller Coverage (14 Workers)

| Poller | Source |
|--------|--------|
| ADS-B | Local BEAST / tar1090 JSON, optional OpenSky supplement |
| AIS | Local AIS-catcher WebSocket or AISstream.io cloud fallback |
| APRS | APRS-IS network |
| Weather | NWS observations, alerts, METAR/TAF, PIREPs/SIGMETs, NWWS, AirNow, Wunderground PWS, GOES tiles |
| Traffic | ODOT TripCheck incidents, cameras, flow sensors |
| Fire | USGS active fire points; NIFC/WFIGS perimeters |
| News | Aggregated RSS and Atom feeds |
| Alerts | FlashAlert, NWS CAP, county RSS |
| P25 | OP25 metadata endpoint |
| MeshCore | MeshCore bridge WebSocket |
| Seismic | USGS earthquake feed |
| GDACS | Global Disaster Alert GeoRSS |
| AI Summary | LiteLLM-compatible situational summary generation |
| Anomaly Detection | Sigma-threshold anomaly alerting on telemetry |

## Configuration Boundaries

- \`.env\` controls infrastructure addresses, region geometry, credentials, and feature behavior
- \`config/sources.yml\` defines user-editable feed and source endpoints

## Persistence Model

PostgreSQL stores: entities, observations, events, geofences, source and alert rule records.

Redis handles: live entity fan-out, hot feed cache, inter-service pub/sub.

## Optional Compose Profiles

| Profile | What it adds |
|---------|-------------|
| \`monitoring\` | Grafana + Prometheus |
| \`offline\` | tileserver-gl for local map tile serving |
`

const envConfig = `# Environment Configuration

Copy \`.env.example\` to \`.env\` before starting.

## Core Infrastructure

| Variable | Purpose |
|----------|---------|
| \`POSTGRES_DB\` | PostgreSQL database name |
| \`POSTGRES_USER\` | PostgreSQL username |
| \`POSTGRES_PASSWORD\` | PostgreSQL password — change before shared deployment |
| \`REDIS_URL\` | Redis connection URL |
| \`FRONTEND_PORT\` | Host port for the frontend container (default: 80) |
| \`LOG_LEVEL\` | Log verbosity: DEBUG, INFO, WARNING, ERROR |

## Region and Bounding Box

| Variable | Purpose |
|----------|---------|
| \`REGION_LAT\` / \`REGION_LON\` | Map center coordinates |
| \`REGION_NAME\` | Region label shown in the app |
| \`BBOX_MIN/MAX_LAT\` | Southern / Northern bounding edge |
| \`BBOX_MIN/MAX_LON\` | Western / Eastern bounding edge |

## Weather and Data Feeds

| Variable | Purpose |
|----------|---------|
| \`NWS_STATION_PRIMARY\` | Primary NWS station (e.g. KHIO) |
| \`NWS_STATION_SECONDARY\` | Fallback station |
| \`NWS_ZONE\` | NWS zone code |
| \`NWS_OFFICE\` | NWS forecast office for text products (e.g. PQR) |
| \`NWS_ALERT_ZONES\` | Comma-separated alert zones |
| \`ODOT_API_KEY\` | TripCheck (traffic) |
| \`AIRNOW_API_KEY\` | AirNow AQI |
| \`AISSTREAM_API_KEY\` | Cloud AIS fallback |
| \`WUNDERGROUND_API_KEY\` | Wunderground PWS API key |
| \`WUNDERGROUND_STATION_ID\` | Wunderground station to poll |

## ADS-B Controls

| Variable | Purpose |
|----------|---------|
| \`ADSB_ENABLE_BEAST\` | Enable BEAST TCP ingest |
| \`ADSB_BEAST_HOST\` / \`ADSB_BEAST_PORT\` | BEAST endpoint |
| \`ADSB_OPENSKY_SUPPLEMENT\` | Enable OpenSky supplemental polling |
| \`ADSB_HISTORY_MODE\` | \`record\` (trails + history) or \`live_only\` |
| \`ADSB_PUBLISH_ONLY_CHANGES\` | Reduce publish noise |

## CoT / TAK Output

| Variable | Purpose |
|----------|---------|
| \`COT_ENABLED\` | Enable CoT UDP multicast (default: false) |
| \`COT_MULTICAST_ADDR\` | Multicast group (standard: 239.2.3.1) |
| \`COT_MULTICAST_PORT\` | UDP port (standard: 6969) |
| \`COT_TAKSERVER_HOST\` | TAK Server TCP host (optional) |
| \`COT_RECEIVE_ENABLED\` | Enable CoT receive mode |

## AI and Anomaly Detection

| Variable | Purpose |
|----------|---------|
| \`SUMMARY_LLM_MODEL\` | LiteLLM model ID (blank = disabled) |
| \`SUMMARY_LLM_API_KEY\` | API key |
| \`SUMMARY_LLM_API_BASE\` | Custom base URL |
| \`ANOMALY_ENABLED\` | Enable anomaly detection (default: true) |
| \`ANOMALY_WINDOW_MINUTES\` | Rolling baseline window |
| \`ANOMALY_SIGMA_THRESHOLD\` | Alert sensitivity (default: 2.5) |

## Authentication

| Variable | Purpose |
|----------|---------|
| \`AUTH_ENABLED\` | Enable login |
| \`AUTH_SECRET_KEY\` | JWT signing secret — use a strong random value |
| \`AUTH_TOKEN_EXPIRE_HOURS\` | Token lifetime |

## TinyGS

Set \`TINYGS_ENABLED=true\` when a local TinyGS station is operational.
`

const sourcesConfig = `# Source Configuration

\`config/sources.yml\` defines operator-managed feeds and local source endpoints.

\`\`\`bash
cp config/sources.example.yml config/sources.yml
\`\`\`

## Top-Level Sections

| Section | Purpose |
|---------|---------|
| \`radio_streams\` | Audio feeds for the tactical audio panel |
| \`news_feeds\` | RSS or Atom feeds shown in the news panel |
| \`alert_feeds\` | High-priority emergency feeds |
| \`poller_sources\` | Local or remote machine endpoints |
| \`alert_zones\` | Default NWS alert zone configuration |
| \`regions\` | One or more region BBOX definitions |

## Region Bounding Boxes

\`regions\` in \`sources.yml\` is the first-choice geographic scope definition. Compatible pollers iterate each enabled region. Falls back to \`.env\` BBOX if absent.

\`\`\`yaml
regions:
  - id: "home"
    name: "Tualatin Valley"
    bbox:
      min_lat: 44.8
      max_lat: 45.9
      min_lon: -123.5
      max_lon: -121.8
    enabled: true
\`\`\`

## Poller Source Types

Supported \`type\` values for \`poller_sources\`:

- \`adsb\` — tar1090 or readsb \`aircraft.json\` endpoint
- \`ais\` — AIS-catcher WebSocket
- \`p25\` — OP25 metadata endpoint
- \`meshcore\` — MeshCore bridge WebSocket
- \`fire\` — open wildfire feed endpoint
- \`aprs\` — APRS-IS host and port

## Behavior Notes

- The poller hot-reloads this file in roughly five seconds.
- The backend mounts it read-write so UI-created sources can be persisted.
- Entries written by the UI use \`source: user\`; hand-authored entries use \`source: config\`.

API keys and infrastructure values belong in \`.env\`, not here.
`

const pollerFiltering = `# Poller Filtering and Distance Rules

How each poller decides what data is in-scope for your deployment.

## Geographic Scope Precedence

1. \`regions\` entries in \`config/sources.yml\` (preferred, multi-region)
2. \`.env\` BBOX fallback (\`BBOX_MIN_LAT\`, \`BBOX_MAX_LAT\`, \`BBOX_MIN_LON\`, \`BBOX_MAX_LON\`)
3. Region center (\`REGION_LAT\`, \`REGION_LON\`) for distance-based gating

## Per-Poller Filtering Matrix

| Poller | Filter method | Config knobs |
|--------|--------------|--------------|
| ADS-B | OpenSky: BBOX query. BEAST: source-local, priority arbitration. | \`BBOX_*\`, \`ADSB_*\` |
| AIS | AISstream: BoundingBoxes. Local AIS-catcher: unfiltered. | \`BBOX_*\`, \`AISSTREAM_API_KEY\` |
| Weather | METAR/TAF/PIREP: BBOX query. AirNow: centerpoint. NWWS/PWS: station IDs. | \`NWS_OFFICE\`, \`WUNDERGROUND_*\` |
| Fire | BBOX pre-filter; post-filter by local radius then regional radius + age. | \`FIRE_*\` |
| NIFC Perimeters | Fetches all North American perimeters; no client-side filter. | — |
| Lightning | BBOX ± 5 degree pad. | \`BBOX_*\` |
| Stream Gauge | USGS bBox parameter. | \`BBOX_*\` |
| Traffic | BBOX clip; cameras ranked by distance from center; flow by corridor name. | \`TRAFFIC_FLOW_CORRIDORS\` |
| Seismic | Distance tiers from center control magnitude acceptance. | \`REGION_LAT/LON\` |
| APRS | APRS-IS centerpoint radius filter. | \`APRS_FILTER_RADIUS_KM\` |
| Alerts | NWS CAP: zone codes; non-NWS: source-defined. | \`NWS_ALERT_ZONES\` |
| GDACS | Distance-gated from center, scaled by alert severity. | \`REGION_LAT/LON\` |
| News / P25 / MeshCore / TinyGS | No geographic filter. | Feed URLs |

## Troubleshooting Empty Feeds

1. Compare \`regions\` in \`sources.yml\` with \`.env\` \`BBOX_*\` values.
2. Check poller logs for upstream API failures.
3. For METAR/TAF, first update can take up to 15 minutes.
4. For GDACS, low-severity events have tight distance gates.
`

const mapKey = `# Map Key

How map symbols render in Vertex by zoom level.

## Zoom Buckets

- **Far**: zoom < 6
- **Mid**: zoom 6–8
- **Close**: zoom ≥ 9

## Entity Layer (ADS-B, AIS, APRS, Hazard)

### Icon behavior by zoom

| Type | Far | Mid | Close |
|------|-----|-----|-------|
| ADS-B (air) | dot | aircraft icon | aircraft icon |
| AIS (sea) | dot | vessel icon | vessel icon |
| APRS (ground) | dot | dot | aprs icon |
| Hazard/Fire | dot | dot | fire icon |

### Icon sizes

- Far: 8 px (all types)
- Mid: ADS-B/AIS default 32 px, selected 40 px; APRS/Hazard 10 px
- Close: ADS-B/AIS/Hazard default 32 px, selected 40 px; APRS default 24 px, selected 30 px

### Colors

- APRS: rgba(179, 136, 255, 230) — atlas violet
- ADS-B / AIS: altitude/speed gradient from colorUtils, or mission tag color if set

### Labels

- APRS labels visible at zoom ≥ 10 — color: rgba(179, 136, 255, 220)

## Lightning Layer

- Far: dot (8 px) | Mid: ring (18 px) | Close: lightning icon (18 px)
- Color: rgb(255, 233, 77), alpha fades with age over 30 seconds

## Stream Gauge Layer

- Far: dot (7 px) | Mid: ring (10 px) | Close: stream icon (18 px)
- Stage colors: normal → cyan | elevated → yellow | minor flood → orange | moderate flood → red | major flood → dark red

## Mesh Node Layer

- Far: dot (8 px) | Mid: ring (12 px) | Close: mesh icon (20 px)
- Active: rgba(255, 143, 0, 240) | Stale: rgba(136, 136, 136, 200)

## Camera Layer

- Far: dot (8 px) | Mid: ring (12 px) | Close: camera icon 22 px / selected 28 px
- Default: rgba(255, 184, 0, 200) | Selected: rgba(255, 184, 0, 255)

## Fire Perimeter Layer (NIFC)

- Filled polygon overlay — semi-transparent orange-red fill, solid stroke
- Toggled via Settings | Refreshed every ~30 minutes from WFIGS GeoJSON

## GOES Satellite Overlay

- Raster WMS tiles via NOAA nowCOAST
- IR and visible modes — toggled via Settings
- Rendered behind entity layers

## Seismic Events

- Deck.gl ScatterplotLayer — point size scales with magnitude, intensity with recency
`

export const DOC_PAGES: DocPage[] = [
  { id: 'getting-started',         title: 'Getting Started',          section: 'Guides',         content: gettingStarted },
  { id: 'features-overview',       title: 'Feature Overview',         section: 'Product',        content: featuresOverview },
  { id: 'architecture-overview',   title: 'Architecture Overview',    section: 'System Design',  content: architectureOverview },
  { id: 'map-key',                 title: 'Map Key',                  section: 'Product',        content: mapKey },
  { id: 'env-configuration',       title: 'Environment Configuration', section: 'Configuration', content: envConfig },
  { id: 'sources-configuration',   title: 'Source Configuration',     section: 'Configuration',  content: sourcesConfig },
  { id: 'poller-filtering',        title: 'Poller Filtering Rules',   section: 'Configuration',  content: pollerFiltering },
]
