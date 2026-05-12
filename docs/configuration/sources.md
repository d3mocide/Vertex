# Source Configuration

Vertex uses `config/sources.yml` to define operator-managed feeds and local source endpoints.

Start from the template:

```bash
cp config/sources.example.yml config/sources.yml
```

## Why This File Exists

This file is meant for dynamic source inventory rather than infrastructure configuration.

Use it for:

- radio streams
- RSS and alert feeds
- local network endpoints for sensor or decoder services
- default weather alert zones

Do not use it for:

- API keys
- database or Redis URLs

Region bounding boxes are supported here under `regions` and are the preferred way to define one or more monitored regions.

API keys and infrastructure values belong in `.env`.

## Behavior Notes

- The poller hot-reloads this file in roughly five seconds.
- The backend mounts it read-write so UI-created sources can be persisted.
- Entries written by the UI typically use `source: user`.
- Hand-authored file entries typically use `source: config`.

## Top-Level Sections

| Section | Purpose |
|---------|---------|
| `radio_streams` | Audio feeds for the tactical audio panel |
| `news_feeds` | RSS or Atom feeds shown in the news panel |
| `alert_feeds` | High-priority emergency or incident feeds |
| `poller_sources` | Local or remote machine endpoints for ingestion workers |
| `alert_zones` | Default NWS alert zone configuration |
| `regions` | One or more region BBOX definitions used by compatible pollers |

## Region Bounding Boxes

`regions` in `sources.yml` is the first-choice geographic scope definition.

Behavior:

1. If one or more enabled `regions` entries exist, compatible pollers iterate those region BBOX values.
2. If `regions` is missing or empty, pollers fall back to `.env` `BBOX_MIN_LAT`, `BBOX_MAX_LAT`, `BBOX_MIN_LON`, and `BBOX_MAX_LON`.

Example:

```yaml
regions:
  - id: "home"
    name: "Tualatin Valley"
    bbox:
      min_lat: 44.8
      max_lat: 45.9
      min_lon: -123.5
      max_lon: -121.8
    enabled: true
```

## Shared Entry Fields

Most source records use a common shape:

| Field | Meaning |
|-------|---------|
| `name` | Display label in the UI or logs |
| `url` | Feed endpoint or host reference |
| `enabled` | Turns the entry on or off |
| `source` | Origin marker such as `config` or `user` |

Some sections also include `format` or `type` to identify how the source should be parsed.

## Radio Streams

`radio_streams` defines live audio sources used by the radio panel.

Example:

```yaml
radio_streams:
  - name: "Local P25"
    url: "http://192.168.1.x:8000/radio.mp3"
    format: mp3
    enabled: true
    source: config
```

Supported example formats in the template:

- `mp3`
- `ogg`
- `aac`

## News and Alert Feeds

`news_feeds` and `alert_feeds` are used for RSS-like content.

Template formats include:

- `rss`
- `flashalert_xml`

Use `alert_feeds` for high-priority emergency sources and `news_feeds` for general context feeds.

## Poller Sources

`poller_sources` connects Vertex to local services or upstream endpoints used by specific pollers.

Supported example `type` values in the current template:

- `adsb`
- `ais`
- `p25`
- `meshcore`
- `fire`
- `aprs`

Example:

```yaml
poller_sources:
  - type: adsb
    name: "Primary ADS-B"
    url: "http://192.168.1.x:8080/data/aircraft.json"
    enabled: true
    source: config
```

Guidance by type:

- `adsb`: typically a tar1090 or readsb `aircraft.json` endpoint
- `ais`: typically a WebSocket served by AIS-catcher
- `p25`: typically an OP25 metadata endpoint
- `meshcore`: typically a MeshCore bridge WebSocket
- `fire`: open wildfire feed endpoint
- `aprs`: APRS-IS host and port or `tcp://` URI

## Alert Zones

`alert_zones` provides default NWS weather alert coverage.

Example:

```yaml
alert_zones:
  nws_zones:
    - "ORZ006"
    - "ORZ005"
  source: config
```

These zone codes should match the region configured in `.env`.

## Editing Guidance

1. Keep disabled entries in the file when you want quick toggling without losing the endpoint.
2. Prefer descriptive `name` values because they appear in the UI and logs.
3. Use `source: config` for committed defaults and let the UI keep `source: user` for runtime additions.
4. Keep `.env` and `sources.yml` aligned when relocating to a new region.

For environment-level settings, see [Environment Configuration](environment.md).