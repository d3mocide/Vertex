# Feature Overview

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

Vertex currently covers several movement and mobility domains.

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

Environmental coverage includes:

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

Traffic and roadway awareness includes:

- ODOT TripCheck incidents
- traffic camera feeds with health monitoring
- traffic flow corridor monitoring
- region-scoped incident filtering and incident detail rendering

## Alerts and Community Context

Vertex merges multiple civic awareness feeds:

- FlashAlert and emergency RSS feeds
- local and regional news feeds
- GDACS disaster alerts
- system event history
- AI-generated situation summaries when `SUMMARY_LLM_MODEL` is configured

## Radio and Audio

The radio feature set includes:

- live tactical audio streams from configurable sources
- P25 metadata ingest for channel and call activity context
- talkgroup management UI for name, priority, and scan list configuration
- configurable remote stream URLs managed through source configuration

## Geofencing and Automation

Automation features include:

- polygon and circle geofences with dwell-based triggering
- event history for entry and exit conditions
- outbound alert rules and webhook dispatching
- Cursor-on-Target (CoT) UDP multicast output for TAK / ATAK integration
- optional CoT receive mode for ingesting external CoT feeds

## TAK / Cursor-on-Target

- CoT emitter sends entity positions as CoT UDP multicast on a configurable address and port
- TAK Server TCP output supported (`COT_TAKSERVER_HOST`)
- CoT receive mode allows ingest of external CoT position reports
- configured via `COT_*` environment variables

## SitRep and Export

- Markdown SitRep export covering a configurable time window
- exports the live event timeline, active alerts, and entity summary
- accessible from the UI without additional tooling

## AI Anomaly Detection

- optional background anomaly detection on ingested telemetry
- sigma-threshold based alerting with configurable window and sensitivity
- enabled via `ANOMALY_ENABLED`, tuned with `ANOMALY_WINDOW_MINUTES` and `ANOMALY_SIGMA_THRESHOLD`

## Replay and Playback

- historical entity playback via `/observations/replay`
- absolute date and time range mode with a custom date picker
- playback timeline with event markers

## Offline and Monitoring Profiles

- `--profile offline` starts tileserver-gl for local raster tile serving
- `--profile monitoring` adds Grafana and Prometheus for dashboards and metrics

## Admin and Security

Operational features include:

- optional JWT authentication with configurable token lifetime
- viewer role for read-only access
- admin metrics dashboard: per-poller ingestion rates, error counts, signal quality, entity freshness, squawk counters, P25 talkgroup activity, mesh battery distribution, and data completeness scorecard
- runtime-editable source definitions via the UI
- rate limiting and Prometheus metrics endpoint

## Implementation Notes

This page is a capability index rather than a changelog. When a new feature is added, document:

1. what the operator can do with it
2. what data source or service it depends on
3. whether it is configured in `.env`, `config/sources.yml`, or both

For config-specific detail, continue with [Environment Configuration](../configuration/environment.md) and [Source Configuration](../configuration/sources.md).
