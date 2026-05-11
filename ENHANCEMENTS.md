# Vertex — Enhancement Roadmap

Tracking document for proposed and in-progress feature enhancements.
Status: `[ ]` pending · `[~]` in progress · `[x]` done · `[-]` deferred/needs research

---

## Metrics Page Additions

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| M1 | Per-poller ingestion rate + error rate | `[x]` | Backend queries DB for obs/min per entity_type mapped to poller; `error_count` added to BasePoller heartbeat; PollerGrid shows obs/min + consecutive errors |
| M2 | Signal quality histogram | `[x]` | `Observation.signal_quality` collected but never visualized. New `/admin/signal-quality` endpoint + `SignalQualityChart` component |
| M3 | Entity freshness heatmap | `[x]` | % of entities with recent update by type. New `/admin/entity-freshness` endpoint + `EntityFreshness` component |
| M4 | Squawk alert counter widget | `[x]` | `/admin/squawk-alerts` endpoint + `SquawkCounter` widget with color-coded 7500/7600/7700 cards |
| M5 | P25 talkgroup activity chart | `[x]` | `/admin/talkgroup-activity` endpoint + `TalkgroupActivity` horizontal bar chart from p25_call_start events |
| M6 | Mesh node battery distribution | `[x]` | `/admin/mesh-battery` endpoint + `MeshBatteryChart` bar chart per node |
| M7 | Data completeness scorecard | `[x]` | `/admin/data-quality` endpoint + `DataQualityCard` showing % filled per field across entity types |
| M8 | WebSocket reconnect timeline | `[x]` | `WsClientChart` sparkline renders ws_clients from existing metrics history — no new backend needed |

---

## New Feed Sources

| # | Source | Status | Notes |
|---|--------|--------|-------|
| F1 | FAA NOTAMs | `[~]` | Legacy FNS/USNS retired April 2026. Replacement: FAA NMS (nms.aim.faa.gov). New developer API at api.faa.gov requires account. Free alt: NASA Digital Information Platform or FAA SWIM/SCDS (free register). Needs evaluation of NMS API shape before implementing |
| F2 | PIREPs + SIGMETs/AIRMETs | `[x]` | Added `_fetch_aviation_hazards()` to WeatherPoller (polls every 15 min); `/weather/aviation/hazards` endpoint; `PirepCard` in EnvironmentPanel |
| F3 | METAR/TAF for nearby airports | `[x]` | Added `_fetch_aviation_obs()` to WeatherPoller; `/weather/aviation/obs` endpoint; `MetarCard` with flight category color coding + TAF expand |
| F4 | NOAA GOES satellite imagery tiles | `[x]` | IR/visible satellite tiles via NOAA nowCOAST WMS proxy. `GOESLayer` + `goesVisible` toggle in Settings |
| F5 | Personal Weather Stations (Wunderground) | `[x]` | `WeatherPoller._fetch_pws()` polls api.weather.com v2. `PWSCard` in EnvironmentPanel. Requires `WUNDERGROUND_API_KEY` + `WUNDERGROUND_STATION_ID` |
| F6 | NWWS (National Weather Wire Service) | `[x]` | `WeatherPoller._fetch_nwws_products()` polls NWS REST API for AFD/HWO/LSR. `NwwsCard` with expandable text in EnvironmentPanel. No key required |
| F7 | USCG NAIS Broadcast | `[ ]` | USCG AIS rebroadcast. Better inland waterway coverage than commercial AIS |
| F8 | GDACS (Global Disaster Alert) | `[x]` | `GdacsPoller` parses GeoRSS, distance-gates by alert level, writes to events table. `GdacsCard` in EnvironmentPanel |
| F9 | USFS Active Fire perimeters (NIFC) | `[x]` | `NifcPoller` fetches WFIGS GeoJSON every 30 min. `FirePerimeterLayer` polygon overlay + `firePerimetersVisible` toggle in Settings |
| F10 | Broadcastify feed metadata | `[ ]` | Listener counts + active feed status for radio streams via Broadcastify API |

---

## Data Collected But Not Displayed

| # | Field | Source | Currently Missing From | Status |
|---|-------|--------|----------------------|--------|
| D1 | `squawk` (emergency codes 7500/7600/7700) | ADS-B identity | Aircraft detail panel | `[x]` Added squawk display with emergency highlighting |
| D2 | `vertical_rate` climb/descent indicator | Observation | Aircraft telemetry tile has value but no color coding | `[x]` Was already displayed; added signed arrow + color |
| D3 | `origin` / `destination` / `phase` | ADS-B identity | Aircraft routing section | `[x]` Already in AircraftOverview; confirmed present |
| D4 | `signal_quality` gauge/trend | Observation | Entity detail panel + metrics page | `[x]` Added to metrics page (M2 above) |
| D5 | `identity.battery_pct` + `identity.snr` | MeshCore identity | No gauge in mesh node detail | `[x]` | Battery gauge + voltage + SNR added to mesh_node section in EntityDetail |
| D6 | `identity.navigational_status` | AIS identity | Vessel detail panel — nav status not shown | `[x]` | Color-coded badge in VesselOverview routing section (emerald=underway, amber=anchor, red=NUC, etc.) |
| D7 | Stream gauge **flow rate** (cfs) | USGS | Only water level shown; flow data in payload | `[x]` | Dedicated `StreamGaugeOverview` component with stage height + discharge (cfs) cards |
| D8 | Seismic **depth** | USGS events | Not shown in event detail | `[x]` | Depth (km) now shown alongside timestamp in SeismicCard event rows |
| D9 | APRS symbol codes | APRS identity | All APRS use same icon; symbol should drive icon | `[x]` | symbol_desc + station_type displayed as badges in AprsOverview panel |
| D10 | Historical replay UI | `/observations/replay` API | Existed but lacked custom date-range picker | `[x]` Added absolute date/time range mode to PlaybackController |
| D11 | TinyGS satellite name + SNR | TinyGS MQTT | Detail panel is minimal | `[ ]` |

---

## Implementation Session Log

### 2026-05-11
- Implemented F4 (NOAA GOES satellite tiles) — `GOESLayer` raster WMS proxy via nowCOAST + Settings toggle
- Implemented F5 (Wunderground PWS) — `WeatherPoller._fetch_pws()` + `/weather/pws` + `PWSCard`
- Implemented F6 (NWS text products / NWWS) — `WeatherPoller._fetch_nwws_products()` + `/weather/nwws` + `NwwsCard`
- Implemented F8 (GDACS disaster alerts) — `GdacsPoller` GeoRSS parser + events table + `GdacsCard`
- Implemented F9 (NIFC fire perimeters) — `NifcPoller` ArcGIS GeoJSON + `FirePerimeterLayer` polygon overlay + Settings toggle
- Added `nws_office`, `wunderground_api_key`, `wunderground_station_id` to poller config

### 2026-05-10
- Implemented M1 (per-poller obs/min + error count) — DB query in `/admin/pollers`, `error_count` in BasePoller heartbeat, PollerGrid UI updated
- Implemented M4 (squawk alert counter) — `/admin/squawk-alerts` + `SquawkCounter` widget
- Implemented M5 (P25 talkgroup activity) — `/admin/talkgroup-activity` + `TalkgroupActivity` chart
- Implemented M6 (mesh battery distribution) — `/admin/mesh-battery` + `MeshBatteryChart`
- Implemented M7 (data completeness scorecard) — `/admin/data-quality` + `DataQualityCard`
- Implemented M8 (WS client timeline) — `WsClientChart` using existing metrics history
- Implemented D5 (mesh battery + SNR gauge in EntityDetail)
- Implemented D6 (nav status color badge in VesselOverview)
- Implemented D7 (stream gauge flow rate via dedicated `StreamGaugeOverview` component)
- Implemented D8 (seismic depth in SeismicCard event rows)
- Marked D9 done (APRS symbol_desc + station_type already displayed as badges in AprsOverview)
- Implemented F2 (PIREPs + SIGMETs/AIRMETs via WeatherPoller + `PirepCard`)
- Implemented F3 (METAR/TAF via WeatherPoller + `MetarCard` with flight category color coding)

### 2026-05-09
- Created this document
- Implemented M2 (signal quality chart) — new backend endpoint + `SignalQualityChart.tsx`
- Implemented M3 (entity freshness widget) — new backend endpoint + `EntityFreshness.tsx`
- Implemented D1 (squawk emergency display in AircraftOverview)
- Implemented D10 (custom date-range picker in PlaybackController)

---

## FAA NOTAM Research Notes

The old NOTAM system (FNS/USNS) was fully retired April 2026. The new **NOTAM Management Service (NMS)** is the authoritative source:
- Portal: `https://nms.aim.faa.gov/`
- Developer API: `https://api.faa.gov/s/` — requires account registration + API key
- FAA SWIM/SCDS: `https://scds.faa.gov` — JMS messaging bus, free to register, delivers NOTAM in AIXM/GeoJSON
- Free REST alternative: NASA Digital Information Platform (`https://dip.amesaero.nasa.gov`) redistributes FAA SWIM data
- Third-party: Notamify (`https://notamify.com`) — free tier, V2 archive endpoint publicly accessible

**Recommended approach:** Register for NASA DIP first (no key, REST API), validate coverage, then upgrade to FAA API portal if needed.
