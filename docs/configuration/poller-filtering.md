# Poller Filtering and Distance Rules

This page documents how each poller decides what data is in-scope for your deployment.

Use this when a feed appears empty or unexpectedly noisy.

## Geographic Scope Precedence

Most pollers use one of these geographic inputs:

1. `regions` entries in `config/sources.yml` (preferred, supports multi-region)
2. `.env` BBOX fallback (`BBOX_MIN_LAT`, `BBOX_MAX_LAT`, `BBOX_MIN_LON`, `BBOX_MAX_LON`)
3. Region center (`REGION_LAT`, `REGION_LON`) for distance-based gating

If `regions` is configured and enabled, compatible pollers iterate each region BBOX.
If `regions` is absent, those pollers fall back to the single `.env` BBOX.

## Aviation Weather (METAR/TAF)

Path:

- Poller fetch: `poller/pollers/weather.py` `_fetch_aviation_obs()`
- Backend cache endpoint: `backend/routers/weather.py` `/weather/aviation/obs`
- Frontend panel: `frontend/src/components/panels/environment/MetarCard.tsx`

Current behavior:

- METAR and TAF requests are sent to aviationweather.gov with a BBOX query.
- There is no nearest-airport or haversine-distance ranking in this path.
- Results are de-duplicated by station ICAO and returned as cached lists.

Operational implications:

- Empty result means no records returned for the configured region bounds and query window, or upstream fetch/parsing failed.
- Poll cadence is every 15 minutes for aviation observations.

## Per-Poller Filtering Matrix

| Poller | Geographic/relevance filter | Config knobs |
|-------|------------------------------|--------------|
| ADS-B (`poller/pollers/adsb.py`) | OpenSky queries are BBOX-scoped (`lamin/lamax/lomin/lomax`). Local BEAST/UltraFeeder data is source-local, then source-priority arbitration decides publish preference. | `BBOX_*`, `ADSB_*` |
| AIS (`poller/pollers/ais.py`) | AISstream fallback uses one or more `BoundingBoxes`; local AIS-catcher source is not geofiltered in poller code. | `regions` or `BBOX_*`, `AISSTREAM_API_KEY` |
| Weather (`poller/pollers/weather.py`) | METAR/TAF/PIREP use BBOX query; AirNow AQI uses centerpoint + fixed 50 distance parameter. | `regions` or `BBOX_*`, `REGION_LAT/LON` |
| Fire (`poller/pollers/fire.py`) | API prefilter uses centerpoint-expanded BBOX. Post-filtering classifies by BBOX-or-radius local relevance, then regional radius and age limits. | `REGION_LAT/LON`, `BBOX_*`, `FIRE_*` |
| Lightning (`poller/pollers/lightning.py`) | WebSocket subscription uses configured BBOX with +/- 5 degree pad. | `BBOX_*` |
| Stream Gauge (`poller/pollers/streamgauge.py`) | USGS query includes `bBox` from configured bounds. | `BBOX_*` |
| Traffic (`poller/pollers/traffic.py`) | Incidents and cameras are clipped to BBOX. Cameras are distance-ranked to region center. Flow is filtered by configured corridor-name fragments. | `BBOX_*`, `REGION_LAT/LON`, `TRAFFIC_FLOW_CORRIDORS` |
| Seismic (`poller/pollers/seismic.py`) | Distance tiers from region center control magnitude threshold acceptance. | `REGION_LAT/LON` |
| APRS (`poller/pollers/aprs.py`) | APRS-IS login filter uses centerpoint radius. | `REGION_LAT/LON`, `APRS_FILTER_RADIUS_KM` |
| Alerts (`poller/pollers/alerts.py`) | NWS CAP feed filtered by zone code list; non-NWS feeds are source-defined. | `NWS_ALERT_ZONES`, `alert_zones` |
| Utilities (`poller/pollers/utilities.py`) | No lat/lon distance filter; county-name filtering for metro aggregation. | Built-in county set |
| News (`poller/pollers/news.py`) | No geographic filtering in poller logic. | Feed URLs |
| P25 (`poller/pollers/p25.py`) | No geographic filtering in poller logic. | Source URLs |
| MeshCore (`poller/pollers/meshcore.py`) | No geographic filtering in poller logic. | Source URLs |
| TinyGS (`poller/pollers/tinygs.py`) | No geographic filtering in poller logic. | TinyGS credentials |

## Troubleshooting Empty or Unexpectedly Small Feeds

1. Confirm effective bounds: compare `regions` in `config/sources.yml` with `.env` `BBOX_*` values.
2. Check poller logs for upstream failures (aviation weather logs failed requests at debug/warn depending path).
3. Verify poll cadence (for METAR/TAF, first update can take up to 15 minutes).
4. Confirm source mode (local source configured vs cloud fallback often changes filter behavior).

## Notes

Distance math in this project is generally haversine where explicit distances are computed.
BBOX checks are inclusive min/max comparisons unless delegated to an upstream API query parameter.
