# Getting Started

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

```bash
cp .env.example .env
cp config/sources.example.yml config/sources.yml
docker compose up -d
```

Open `http://localhost` after the containers are healthy.

## Minimum Setup Checklist

Vertex will boot without every optional integration being configured, but a useful deployment usually needs at least:

- Regional coordinates and bounding box in `.env`
- One or more enabled feeds in `config/sources.yml`
- `ODOT_API_KEY` if you want TripCheck traffic data
- `AIRNOW_API_KEY` if you want AQI data
- `AISSTREAM_API_KEY` only when you are using AISstream instead of a local AIS feed

## Local-First Configuration Model

Vertex has two main configuration surfaces:

- `.env` for infrastructure, region, feature toggles, and API credentials
- `config/sources.yml` for editable source definitions such as radio streams, news feeds, alert feeds, and local poller endpoints

The source file is hot-reloaded by the poller and can also be updated through the UI for user-managed sources.

## Typical Bring-Up Flow

Before using the setup wizard or any configuration screen, set `AUTH_ENABLED=true`, generate `AUTH_SECRET_KEY` with `openssl rand -hex 32`, and restart the backend. With authentication disabled Vertex is intentionally viewer-only and rejects all writes. Compose also requires unique `POSTGRES_PASSWORD` and `REDIS_PASSWORD` values.

### 1. Set the region

Update the region center (`REGION_LAT`, `REGION_LON`), region name, and bounding box in `.env` so feeds are filtered for your area.

The frontend learns the region from the backend when it loads, so no rebuild is needed. After changing region values in `.env`, restart the backend and poller (`docker compose up -d --force-recreate backend poller`) and reload the page.

Leave `REGION_LAT` and `REGION_LON` out of `.env` if you would rather choose the region in the app. On first sign-in Vertex opens a **setup wizard**: pick your location, confirm the region, choose from the installed region packs (or core feeds only), and see which API keys the pack wants. Until you finish, the poller waits rather than collecting data for the wrong place (set `SETUP_GATE=false` to skip the wait and use the built-in defaults). To change the region later, run the wizard again from the admin console (Region), then restart the poller (`docker compose restart poller`); the screen tells you when that is needed. Values set in `.env` always win and pin the region (the wizard then warns and refuses to save).

### 2. Add source endpoints

Edit `config/sources.yml` to point Vertex at your local or preferred remote sources.

Examples:

- a local BEAST receiver (`ADSB_BEAST_HOST`/port) and, optionally, tar1090 or Ultrafeeder JSON as a standby
- an OpenSky API client (`ADSB_OPENSKY_CLIENT_ID` / `_SECRET`) if you want the OpenSky gap-filler beyond anonymous limits
- AIS WebSocket from AIS-catcher
- OP25 endpoint and audio stream
- Local or regional RSS feeds for alerts and news

### 3. Start services

```bash
docker compose up -d
docker compose logs -f backend
docker compose logs -f poller
```

### 4. Create the first account

When `AUTH_ENABLED=true`, the first visit asks you to create the administrator account. Later users and API keys are managed from the admin screens. When authentication is disabled, Vertex remains a read-only viewer and the setup wizard cannot save changes.

### 5. Verify the UI

Check that:

- you can sign in with the account you created

- the map loads
- entities appear for enabled feeds
- side panels populate with weather, traffic, alerts, or radio content
- live updates continue through the WebSocket connection

## Development Validation

Common validation commands for local changes:

```bash
cd frontend && npx tsc --noEmit
docker compose config --quiet
python3 -m py_compile backend/main.py poller/main.py
```

For a fuller architecture view, continue with [Architecture Overview](architecture/overview.md). For settings reference, use [Environment Configuration](configuration/environment.md) and [Source Configuration](configuration/sources.md).