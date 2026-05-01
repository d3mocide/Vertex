# Feature Overview

This page summarizes the major capability areas currently implemented in Vertex.

## Situational Map

The map is the primary operating surface.

Current map-oriented capabilities include:

- live aircraft, vessel, APRS, wildfire, and mesh node rendering
- track and trail visualization for moving entities
- region-aware filtering using configured bounding boxes
- smoke and radar overlays for environmental context
- searchable entity detail with enrichment fields where available

## Transportation and Mobility

Vertex currently covers several movement and mobility domains.

### Aircraft

- OpenSky polling and local ADS-B JSON ingest
- BEAST transport support for live decoder integration
- aircraft metadata enrichment, route context, and airport references
- optional observation history persistence for trails and analysis

### Marine

- AISstream.io fallback or local AIS WebSocket ingest
- vessel normalization and live map rendering

### Amateur and Community RF

- APRS-IS ingest for radio and community station tracking
- MeshCore endpoint support for mesh node awareness

## Weather and Environment

Environmental coverage includes:

- NWS observations and weather alerts
- AirNow AQI integration
- wildfire ingest with local versus regional relevance handling
- smoke overlay support and environment panel wildfire status
- seismic event ingestion and live event panel updates

## Traffic and Infrastructure

Traffic and roadway awareness includes:

- ODOT TripCheck incidents
- traffic camera feeds
- traffic flow corridor monitoring
- region-scoped incident filtering and incident detail rendering

## Alerts and Community Context

Vertex merges multiple civic awareness feeds:

- FlashAlert and emergency RSS feeds
- local and regional news feeds
- system event history
- AI-generated situation summaries when summary settings are configured

## Radio and Audio

The radio feature set includes:

- live tactical audio streams from configurable sources
- P25 metadata ingest for channel and call activity context
- configurable remote stream URLs managed through source configuration

## Geofencing and Automation

Automation features include:

- polygon and circle geofences
- dwell-based geofence triggering
- event history for entry and exit conditions
- outbound alert rules and webhook dispatching

## Admin and Security

Operational features include:

- optional authentication and JWT login flow
- admin routes and settings management
- runtime-editable source definitions

## Implementation Notes

This page is a capability index rather than a changelog. When a new feature is added, document:

1. what the operator can do with it
2. what data source or service it depends on
3. whether it is configured in `.env`, `config/sources.yml`, or both

For config-specific detail, continue with [Environment Configuration](../configuration/environment.md) and [Source Configuration](../configuration/sources.md).