# Vertex

> See your neighborhood sharper

Vertex is a local-first, real-time situational awareness dashboard. It fuses aircraft, vessel, weather, traffic, emergency alert, and P25 radio data into a single map-centric interface — running on hardware you own, in your home.

Part of the [Sovereign Watch](https://github.com/d3mocide) family of local intelligence tools.

---

## What It Does

| Panel | What you see |
|-------|-------------|
| **Map** | Live aircraft positions and vessel tracks on a MapLibre GL map |
| **Infrastructure** | ODOT CCTV camera thumbnails, real-time road speeds, traffic incidents |
| **Environment** | NWS weather observations, active alerts, AQI, radar overlay |
| **Community** | Emergency alerts aggregated from FlashAlert, county EM, and city feeds |
| **Tactical Audio** | Live P25 trunked radio stream (OP25 → Icecast → browser) |

Geofences trigger entry/exit events. All entity positions are stored for 30-day trail history.

---

## Architecture

Five containers — minimal footprint, runs on a Raspberry Pi 5:

| Container | Role |
|-----------|------|
| `db` | PostgreSQL 16 + PostGIS |
| `redis` | Hot state cache + pub/sub event bus |
| `backend` | FastAPI REST + WebSocket API |
| `poller` | All background data pollers |
| `frontend` | React + MapLibre GL, served by Nginx |

An optional `--profile sdr` brings up `ultrafeeder`, `op25`, `audio-bridge`, `icecast`, and `meshcore` for full off-grid operation with local hardware.

---

## Requirements

- Docker and Docker Compose
- x86_64 or ARM64 (all images build native for both — no emulation on Pi 5)

For the SDR profile:
- One or two RTL-SDR dongles (ADS-B + P25)
- Assign serial numbers before first use: `rtl_eeprom -d 0 -s adsb001`

---

## Quick Start

### Core stack (internet feeds only)

```bash
cp .env.example .env
# Fill in API keys (see Configuration below)
docker compose up -d
```

Open `http://localhost` (or your Pi's IP).

### Remote radio mode

Use this when OP25/Icecast run on a separate machine on your network:

```bash
cp .env.remote.example .env.remote
# Set VITE_PROXY_OP25_TARGET and VITE_PROXY_ICECAST_TARGET to the remote host
docker compose --env-file .env.remote up -d
```

### Full local SDR mode

Runs everything including OP25, Icecast, Ultrafeeder, and AIS-catcher in the stack:

```bash
cp .env.local-sdr.example .env.local-sdr
# Set SDR serial numbers and tuning parameters
docker compose --env-file .env.local-sdr --profile sdr up -d
```

**PowerShell shortcuts (Windows):**
```powershell
.\up-remote.ps1           # Remote mode
.\up-remote.ps1 -Build    # Remote mode with rebuild
.\up-local-sdr.ps1        # Full SDR mode
.\up-local-sdr.ps1 -Build # Full SDR mode with rebuild
```

---

## Configuration

Copy the appropriate example file and fill in your values. The `VERTEX_ENV_FILE` variable tells the backend and poller containers which file to load.

### API Keys

| Key | Source | Required |
|-----|--------|----------|
| `ODOT_API_KEY` | [developer.odot.state.or.us](https://developer.odot.state.or.us) — free, instant activation | Traffic feeds |
| `AISSTREAM_API_KEY` | [aisstream.io](https://aisstream.io) — free tier | Vessel tracking (if no local AIS-catcher) |
| `AIRNOW_API_KEY` | [airnowapi.org](https://www.airnowapi.org) — free | AQI display |

Aircraft tracking via OpenSky Network requires no key (rate-limited). A local Ultrafeeder removes that dependency entirely.

### Region

The default region is the Tualatin/Portland metro (45.38°N, 122.76°W). To relocate, update these vars in your `.env` file:

```env
REGION_LAT=45.3842
REGION_LON=-122.7635
REGION_ALT=100ft
REGION_NAME=Tualatin Valley
BBOX_MIN_LAT=44.8
BBOX_MAX_LAT=45.9
BBOX_MIN_LON=-123.5
BBOX_MAX_LON=-121.8
```

NWS zone codes (`NWS_ZONE`, `NWS_ALERT_ZONES`) and local RSS feed URLs in `poller/pollers/alerts.py` will also need updating for a different region. Full regional portability is a planned milestone.

---

## Data Sources

All public, free, and operator-run. No cloud lock-in.

| Feed | Source | Interval |
|------|--------|----------|
| Aircraft | OpenSky Network or local Ultrafeeder | 5 s |
| Vessels | AISstream.io or local AIS-catcher | WebSocket |
| Weather | NWS `api.weather.gov` | 5 min |
| Weather alerts | NWS CAP (multi-county) | 5 min |
| Traffic incidents | ODOT TripCheck API | 60 s |
| Traffic cameras | ODOT TripCheck API | on demand |
| Traffic flow | ODOT Traffic Detector API | 60 s |
| Emergency alerts | FlashAlert, WashCo EM, City RSS | 60 s |
| P25 audio | OP25 + Icecast (local SDR) | live stream |
| Mesh nodes | MeshCore (serial or network) | WebSocket |

---

## Raspberry Pi 5 Notes

- **RAM budget at idle**: ~520 MB (redis 50 + postgres 150 + backend 200 + poller 100 + nginx 20)
- **Storage**: Mount `db_data` and `redis_data` volumes on SSD, not SD card
- **USB SDRs**: Assign serial numbers with `rtl_eeprom` before deployment to prevent device conflicts across multiple dongles
- **Ultrafeeder tmpfs**: High-frequency JSON state files write to tmpfs to protect flash storage
- **Cross-compile**: `docker buildx build --platform linux/arm64` from an x86 dev machine for fast Pi builds

---

## License

GPL-3.0 — see [LICENSE](LICENSE).
