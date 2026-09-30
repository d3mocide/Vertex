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
| `REGION_LAT` | Map center latitude. Setting this or `REGION_LON` pins the region to the environment |
| `REGION_LON` | Map center longitude |
| `REGION_NAME` | Region label shown in the app |

**Precedence:** environment variables win, then a region saved in the app (stored in the database), then the built-in defaults. `GET /api/v1/config/region` reports the region in force, where it came from (`env`, `database` or `default`) and whether it is locked by the environment. Leave `REGION_LAT` and `REGION_LON` unset to manage the region in the app. Bounding-box variables (`BBOX_*`) and the NWS office remain environment settings when the region is pinned.
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
| `NWS_OFFICE` | NWS forecast office identifier | Used to fetch NWWS text products (AFD, LSR, CF6). Example: `PQR` |
| `NWS_ALERT_ZONES` | Comma-separated alert zones | Used as startup fallback if alert zones are not populated elsewhere |
| `ODOT_API_KEY` | TripCheck API key | Required for traffic feeds |
| `AIRNOW_API_KEY` | AirNow API key | Required for AQI |
| `AISSTREAM_API_KEY` | AISstream API key | Only needed when using cloud AIS fallback |

## Wildfire and APRS Controls

| Variable | Purpose | Notes |
|----------|---------|-------|
| `FIRE_ALERT_RADIUS_KM` | Local wildfire alert radius | Fires within bbox or this radius remain alertable |
| `FIRE_ALERT_RECENT_HOURS` | Max age for local fire alert retention | Suppresses stale local incidents |
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
| `ADSB_BEAST_STALE_THRESHOLD_SECONDS` | Seconds before a BEAST-sourced entity is considered stale |
| `ADSB_BEAST_HTTP_FALLBACK` | Keeps HTTP polling active while BEAST is enabled |
| `ADSB_PUBLISH_ONLY_CHANGES` | Reduces aircraft publish noise by emitting only changed updates |
| `ADSB_OPENSKY_SUPPLEMENT` | Enables OpenSky as a gap-filler: it only supplies aircraft the local receiver and community feeds missed |
| `ADSB_OPENSKY_INTERVAL` | OpenSky poll interval in seconds (default `120`; one poll costs 1 credit for a typical region) |
| `ADSB_OPENSKY_STALE_THRESHOLD` | Seconds an aircraft must be unseen locally before OpenSky may update it |
| `ADSB_OPENSKY_RECORD_OBSERVATIONS` | Persists OpenSky observations to history |
| `ADSB_OPENSKY_CLIENT_ID` | OpenSky OAuth2 API client id (optional; without it polling is anonymous, 400 credits/day, floored at 220s) |
| `ADSB_OPENSKY_CLIENT_SECRET` | OpenSky OAuth2 API client secret |
| `ADSB_COMMUNITY_SUPPLEMENT` | Enables the airplanes.live / adsb.fi community feeds (default on): fresh positions plus registration, type and owner |
| `ADSB_COMMUNITY_INTERVAL` | Community poll interval in seconds (default `15`; both services allow 1 request/second) |
| `ADSB_COMMUNITY_RADIUS_NM` | Query radius around `REGION_LAT`/`REGION_LON` in nautical miles (default `75`) |
| `ADSB_COMMUNITY_URLS` | Comma-separated endpoint templates, tried in order (`{lat}` `{lon}` `{radius}` are filled in) |
| `ADSB_POSITION_STALE_SECONDS` | Seconds since the last resolved BEAST position before a track is flagged stale |
| `ADSB_DEAD_RECKON_MAX_SECONDS` | Longest a stale position is projected forward along its last velocity (`0` disables) |

OpenSky accepts OAuth2 API clients only (username/password no longer works). Without a client, polling is anonymous (400 credits/day) and is floored at 220 s automatically. Source priority for every aircraft is local BEAST, then community, then OpenSky, and an older position never overwrites a newer one.
| `ADSB_HISTORY_MODE` | Observation storage mode: `record` or `live_only` |
| `ADSB_ENRICHMENT_CACHE_DIR` | Directory for enrichment reference data |
| `ADSB_AIRCRAFT_DB_PATH` | Aircraft metadata CSV path |
| `ADSB_AIRPORTS_DB_PATH` | Airports reference file path |
| `ADSB_AIRLINES_DB_PATH` | Airline reference file path |
| `ADSB_NAVAIDS_DB_PATH` | Navaids reference file path |

`ADSB_HISTORY_MODE=record` stores observation history for trails and historical queries. `live_only` keeps live tracking and geofence behavior while reducing database write volume.

## CoT / TAK Output

Cursor-on-Target (CoT) output sends entity positions to TAK-compatible receivers.

| Variable | Purpose | Notes |
|----------|---------|-------|
| `COT_ENABLED` | Enables CoT UDP multicast output | Default: `false` |
| `COT_MULTICAST_ADDR` | Multicast group address | Standard TAK address: `239.2.3.1` |
| `COT_MULTICAST_PORT` | Multicast UDP port | Standard TAK port: `6969` |
| `COT_STALE_SECONDS` | CoT stale timeout in seconds | |
| `COT_TAKSERVER_HOST` | TAK Server host for TCP output | Leave blank to use multicast only |
| `COT_TAKSERVER_PORT` | TAK Server TCP port | Typically `8087` |
| `COT_RECEIVE_ENABLED` | Enables CoT receive mode for ingesting external CoT feeds | |
| `COT_RECEIVE_HOST` | Host to bind the CoT receiver | |
| `COT_RECEIVE_PORT` | Port for the CoT receiver | |

## Traffic and Frontend Settings

| Variable | Purpose | Notes |
|----------|---------|-------|
| `TRAFFIC_FLOW_CORRIDORS` | Comma-separated ODOT highway names (exact, e.g. `I-5,I-205,US26,OR-217`) | Which freeways get corridor speed status |
| `VITE_RADAR_LAYER` | Primary radar overlay layer ID | Frontend build-time variable |
| `VITE_RADAR_FALLBACK_LAYER` | Fallback radar layer at low zoom | Frontend build-time variable |
| `VITE_RADAR_FALLBACK_MAX_ZOOM` | Zoom threshold below which fallback layer activates | Frontend build-time variable |
| `VITE_OBSERVATION_RANGE_KM` | Trail/history display radius | Frontend build-time variable |
| `VITE_PRESERVE_DRAWING_BUFFER` | Enables WebGL drawing buffer preservation (needed for canvas exports) | Frontend build-time variable |

## TinyGS

| Variable | Purpose |
|----------|---------|
| `TINYGS_ENABLED` | Enables TinyGS satellite ground station polling |

TinyGS credentials and station configuration are managed separately through the TinyGS platform. Enable this only when a local TinyGS station is operational.

## AI Summary Settings

| Variable | Purpose |
|----------|---------|
| `SUMMARY_LLM_MODEL` | LiteLLM-compatible model identifier |
| `SUMMARY_LLM_API_KEY` | API key for the selected model provider |
| `SUMMARY_LLM_API_BASE` | Custom base URL for self-hosted or proxy backends |
| `SUMMARY_LLM_MAX_TOKENS` | Output token budget for the completion (default `4096`) |

Leave `SUMMARY_LLM_MODEL` blank to disable summary generation.

Reasoning ("thinking") models emit an internal reasoning trace before their
final answer and can exhaust `SUMMARY_LLM_MAX_TOKENS` on that trace alone,
leaving the answer empty. If the briefing panel shows nothing, or logs show
`LLM ... produced no answer content`, raise `SUMMARY_LLM_MAX_TOKENS` (or
disable the model's thinking mode, if the backend supports it).

## P25 Transcription (Whisper) Settings

Runs in the `transcription` container. Transcribes P25 call recordings either locally (CPU, via `faster-whisper`) or remotely through LiteLLM.

| Variable | Purpose | Notes |
|----------|---------|-------|
| `WHISPER_MODEL` | Local faster-whisper model size | `tiny`/`base`/`small`/`medium`; ignored when `WHISPER_REMOTE_MODEL` is set |
| `WHISPER_LANGUAGE` | ISO 639-1 language code | `auto` lets Whisper detect per-call |
| `WHISPER_COMPUTE_TYPE` | Local inference precision | `int8` is fastest/lowest-RAM for CPU |
| `WHISPER_DEVICE` | Local inference device | `cpu` |
| `WHISPER_CPU_THREADS` | ctranslate2 threads for local inference | Keep at `1` on small hosts to avoid starving the poller/API |
| `WHISPER_REMOTE_MODEL` | LiteLLM model identifier for remote STT (e.g. `openai/whisper-1`, `groq/whisper-large-v3`) | Leave blank to transcribe locally; when set, skips loading the local model entirely |
| `WHISPER_REMOTE_API_BASE` | Base URL for a local AI node or LiteLLM proxy exposing an OpenAI-compatible `/audio/transcriptions` endpoint | Same convention as `SUMMARY_LLM_API_BASE` |
| `WHISPER_REMOTE_API_KEY` | API key for the remote STT provider, if required | |

## Anomaly Detection Settings

| Variable | Purpose | Notes |
|----------|---------|-------|
| `ANOMALY_ENABLED` | Enables background anomaly detection | Default: `true` |
| `ANOMALY_WINDOW_MINUTES` | Rolling window for baseline calculation | Default: `60` |
| `ANOMALY_SIGMA_THRESHOLD` | Standard deviations above baseline to trigger an alert | Default: `2.5` |

## Authentication Settings

| Variable | Purpose |
|----------|---------|
| `AUTH_ENABLED` | Enables application login |
| `AUTH_SECRET_KEY` | JWT signing secret |
| `AUTH_TOKEN_EXPIRE_HOURS` | Token lifetime in hours |

Use a strong random value for `AUTH_SECRET_KEY` before enabling authentication.

## CORS and TLS

| Variable | Purpose |
|----------|---------|
| `CORS_ORIGINS` | JSON array of allowed origins for CORS | Example: `["http://localhost:3000"]` |
| `CORS_ALLOW_CREDENTIALS` | Whether to allow credentialed cross-origin requests |
| `TLS_CERT_PATH` | Path to TLS certificate (used with the `tls` Compose profile) |
| `TLS_KEY_PATH` | Path to TLS private key |

## Transit (TriMet)

| Variable | Purpose |
|----------|---------|
| `TRIMET_GTFS_ENABLED` | Enables MAX, WES and Streetcar real-time positions |
| `TRIMET_APP_ID` | Free TriMet developer AppID |
| `TRIMET_ROUTE_TYPES` | GTFS route types to show (default `0,1,2`: tram, subway, rail) |
| `TRIMET_POLL_INTERVAL` | Seconds between polls |
| `TRIMET_GTFS_STATIC_URL`, `TRIMET_GTFS_RT_URL` | Endpoint overrides (rarely needed) |

## Radio (P25) Audio and Incidents

| Variable | Purpose |
|----------|---------|
| `P25_AUDIO_ENABLED` | Records per-call audio segments |
| `P25_AUDIO_WS_URL` | OP25 audio websocket(s), e.g. `ws://host:9000`; comma-separate several receivers in `multi_rx` channel order. Lossless and without the Icecast delay |
| `P25_AUDIO_DIR` | Where recordings are stored |
| `P25_AUDIO_RETENTION_DAYS` | Days of audio kept |
| `P25_AUDIO_DELAY_SECONDS` | Delay applied to live playback |
| `RADIO_INCIDENTS_WINDOW_HOURS` | Hours of transcripts mined for structured radio incidents |
| `GEOCODER_URL` | Self-hosted Nominatim (see `infra/nominatim/README.md`); blank disables geocoding of incident addresses |
| `GEOCODER_STATE` | State of the imported Nominatim extract |

## Briefing (AI Summary) Tuning

In addition to the settings above:

| Variable | Purpose |
|----------|---------|
| `SUMMARY_INTERVAL_MINUTES` | How often the briefing regenerates |
| `SUMMARY_WINDOW_HOURS` | Time span the briefing covers |
| `SUMMARY_MIN_REGEN_S` | Minimum seconds between UI-triggered refreshes and retries |
| `SUMMARY_BASELINE_DAYS` | Days of history used as the "normal" baseline |
| `SUMMARY_HISTORY_LEN` | Previous briefings kept for "changes since last briefing" |
| `SUMMARY_CONTEXT_MAX_CHARS` | Character budget for the data context (about 4 characters per token); the model's context window must fit this plus instructions and the answer |
| `SUMMARY_LLM_TIMEOUT_S` | Request timeout |
| `SUMMARY_LLM_TEMPERATURE`, `SUMMARY_LLM_REASONING_EFFORT` | Optional sampling controls (blank = provider default) |
| `SUMMARY_LLM_EXTRA_BODY` | Raw JSON merged into the request body for server-specific options |
| `REGION_TIMEZONE` | IANA timezone for local times in the briefing |

## Optional Integrations and Misc

| Variable | Purpose |
|----------|---------|
| `MQTT_ENABLED`, `MQTT_PORT` | Built-in Mosquitto broker for IoT sensors (rtl_433, Meshtastic, AIS-catcher) |
| `MQTT_<SOURCE>_USERNAME` / `_PASSWORD` | Credentials for an authenticated MQTT source, named after the source in `sources.yml` (e.g. `MQTT_REMOTE_BROKER_USERNAME`) |
| `ACARS_ENABLED` | Enables the ACARS decoder feed |
| `FLASHALERT_ENABLED`, `FLASHALERT_URL` | FlashAlert feed fallback / URL override |
| `TVFR_ENABLED`, `TVFR_RSS_URL` | TVF&R feed fallback / URL override |
| `FIRMS_MAP_KEY` | Free NASA FIRMS key that enables satellite fire hotspots |
| `NWS_CLIMATE_STATION` | Station id for daily climate reports (CF6), e.g. `PDX` |
| `NIFC_PERIMETER_MAX_AGE_DAYS` | Fire perimeters not updated within this many days are not fetched |
| `MESH_BBOX_FILTER`, `MESH_BBOX_PAD_DEG` | Drop MeshCore nodes advertised outside the configured region (plus padding in degrees) |
| `VITE_MESH_NODE_STALE_HOURS` | Hours since a mesh node's last advert before it shows as stale (keep above one 24-48 h advert cycle) |
| `COT_ENTITY_TYPES` | Entity types emitted over CoT (comma-separated, empty = all) |
| `ADVISORY_RADIUS_KM` | "Nearby" radius for the advisory bar and sidebar |
| `BOUNDARY_ZIP_LOOKUP_ENABLED` | Geofence ZIP boundaries come from US Census TIGERweb (sends the ZIP to census.gov); `false` keeps lookups local |
| `ALLOW_PRIVATE_IPS` | SSRF guard switch: outbound requests from the weather, alerts, transit and similar pollers (and admin probes) are refused when they resolve to loopback/LAN addresses unless this is `true`. Leave `false` unless a feed you configured lives on a private address |

## Recommended Editing Order

1. Set database and Redis values if your deployment differs from Compose defaults.
2. Update the region center and bounding box.
3. Fill in required feed API keys.
4. Enable optional analytics or auth features.
5. Pair the `.env` changes with matching feed definitions in `config/sources.yml`.

For source definitions, continue with [Source Configuration](sources.md).
