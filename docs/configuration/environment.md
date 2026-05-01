# Environment Configuration

Vertex uses `.env` for infrastructure, regionalization, feature behavior, and optional credentials.

Start by copying `.env.example` to `.env`.

```bash
cp .env.example .env
```

## Core Infrastructure

| Variable | Purpose | Notes |
|----------|---------|-------|
| `POSTGRES_DB` | PostgreSQL database name | Used by the Compose database container |
| `POSTGRES_USER` | PostgreSQL username | Used during database initialization |
| `POSTGRES_PASSWORD` | PostgreSQL password | Change from the example value before shared deployment |
| `REDIS_URL` | Redis connection URL | Consumed by backend and poller |
| `FRONTEND_PORT` | Host port for the frontend container | Defaults to `80` |
| `LOG_LEVEL` | Application log verbosity | Typical values: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

## Region and Bounding Box

These settings control map centering and feed relevance.

| Variable | Purpose |
|----------|---------|
| `REGION_LAT` | Default map latitude |
| `REGION_LON` | Default map longitude |
| `REGION_ALT` | Human-readable reference altitude |
| `REGION_NAME` | Region label shown in the app |
| `BBOX_MIN_LAT` | Southern bounding edge |
| `BBOX_MAX_LAT` | Northern bounding edge |
| `BBOX_MIN_LON` | Western bounding edge |
| `BBOX_MAX_LON` | Eastern bounding edge |

When relocating the system, update the region center, bounding box, and weather zone settings together.

## Weather and Public Data Feeds

| Variable | Purpose | Notes |
|----------|---------|-------|
| `NWS_STATION_PRIMARY` | Primary NWS observation station | Example: `KHIO` |
| `NWS_STATION_SECONDARY` | Secondary observation station | Fallback station |
| `NWS_ZONE` | Primary NWS zone code | Used for local weather context |
| `NWS_ALERT_ZONES` | Comma-separated alert zones | Used as startup fallback if alert zones are not populated elsewhere |
| `ODOT_API_KEY` | TripCheck API key | Required for traffic feeds |
| `AIRNOW_API_KEY` | AirNow API key | Required for AQI |
| `AISSTREAM_API_KEY` | AISstream API key | Only needed when using cloud AIS fallback |

## Wildfire and APRS Controls

| Variable | Purpose | Notes |
|----------|---------|-------|
| `FIRE_ALERT_RADIUS_KM` | Local wildfire alert radius | Fires within bbox or this radius remain alertable |
| `FIRE_REGIONAL_RADIUS_KM` | Regional wildfire awareness radius | Used for smoke and context awareness |
| `FIRE_REGIONAL_RECENT_HOURS` | Max age for regional wildfire retention | Suppresses stale distant incidents |
| `APRS_CALLSIGN` | APRS-IS login callsign | Used when APRS fallback is enabled |
| `APRS_PASSCODE` | APRS-IS passcode | Default `-1` is receive-only behavior |
| `APRS_FILTER_RADIUS_KM` | APRS feed radius | Controls APRS ingestion scope |

## ADS-B Controls

These settings control aircraft ingest strategy and enrichment behavior.

| Variable | Purpose |
|----------|---------|
| `ADSB_ENABLE_BEAST` | Enables BEAST TCP ingest path |
| `ADSB_BEAST_HOST` | BEAST endpoint host |
| `ADSB_BEAST_PORT` | BEAST endpoint port |
| `ADSB_BEAST_RECONNECT_INITIAL_SECONDS` | Initial reconnect delay |
| `ADSB_BEAST_RECONNECT_MAX_SECONDS` | Maximum reconnect delay |
| `ADSB_BEAST_HTTP_FALLBACK` | Keeps HTTP polling active while BEAST is enabled |
| `ADSB_PUBLISH_ONLY_CHANGES` | Reduces aircraft publish noise by emitting only changed updates |
| `ADSB_HISTORY_MODE` | Observation storage mode: `record` or `live_only` |
| `ADSB_AIRCRAFT_DB_PATH` | Aircraft metadata CSV path |
| `ADSB_AIRPORTS_DB_PATH` | Airports reference file path |
| `ADSB_AIRLINES_DB_PATH` | Airline reference file path |
| `ADSB_NAVAIDS_DB_PATH` | Navaids reference file path |

`ADSB_HISTORY_MODE=record` stores observation history for trails and historical queries. `live_only` keeps live tracking and geofence behavior while reducing database write volume.

## Traffic and Frontend Settings

| Variable | Purpose | Notes |
|----------|---------|-------|
| `TRAFFIC_FLOW_CORRIDORS` | Comma-separated highway filters | Used to narrow traffic detector coverage |
| `VITE_RADAR_LAYER` | Radar overlay layer ID | Frontend build-time variable |
| `VITE_OBSERVATION_RANGE_KM` | Trail/history display radius | Frontend build-time variable |

## Optional AI Summary Settings

| Variable | Purpose |
|----------|---------|
| `SUMMARY_LLM_MODEL` | LiteLLM-compatible model identifier |
| `SUMMARY_LLM_API_KEY` | API key for the selected model provider |
| `SUMMARY_LLM_API_BASE` | Custom base URL for self-hosted or proxy backends |

Leave `SUMMARY_LLM_MODEL` blank to disable summary generation.

## Authentication Settings

| Variable | Purpose |
|----------|---------|
| `AUTH_ENABLED` | Enables application login |
| `AUTH_SECRET_KEY` | JWT signing secret |
| `AUTH_TOKEN_EXPIRE_HOURS` | Token lifetime in hours |

Use a strong random value for `AUTH_SECRET_KEY` before enabling authentication.

## Recommended Editing Order

1. Set database and Redis values if your deployment differs from Compose defaults.
2. Update the region center and bounding box.
3. Fill in required feed API keys.
4. Enable optional analytics or auth features.
5. Pair the `.env` changes with matching feed definitions in `config/sources.yml`.

For source definitions, continue with [Source Configuration](sources.md).