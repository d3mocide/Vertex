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

### 1. Set the region

Update the region center, region name, and bounding box in `.env` so feeds are filtered for your area.

### 2. Add source endpoints

Edit `config/sources.yml` to point Vertex at your local or preferred remote sources.

Examples:

- ADS-B JSON feed from tar1090 or Ultrafeeder
- AIS WebSocket from AIS-catcher
- OP25 endpoint and audio stream
- Local or regional RSS feeds for alerts and news

### 3. Start services

```bash
docker compose up -d
docker compose logs -f backend
docker compose logs -f poller
```

### 4. Verify the UI

Check that:

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