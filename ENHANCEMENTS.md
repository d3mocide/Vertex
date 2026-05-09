# Vertex — Enhancement Roadmap

Tracking document for proposed and in-progress feature enhancements.
Status: `[ ]` pending · `[~]` in progress · `[x]` done · `[-]` deferred/needs research

---

## Metrics Page Additions

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| M1 | Per-poller ingestion rate + error rate | `[ ]` | Poller grid shows heartbeat but not throughput. Add obs/min + error % column per source to PollerGrid |
| M2 | Signal quality histogram | `[x]` | `Observation.signal_quality` collected but never visualized. New `/admin/signal-quality` endpoint + `SignalQualityChart` component |
| M3 | Entity freshness heatmap | `[x]` | % of entities with recent update by type. New `/admin/entity-freshness` endpoint + `EntityFreshness` component |
| M4 | Squawk alert counter widget | `[ ]` | Count 7500/7600/7700 emergency squawks seen. Separate from entity panel display. New metric card on metrics page |
| M5 | P25 talkgroup activity chart | `[ ]` | Calls-per-talkgroup over rolling window. Data in events but not charted |
| M6 | Mesh node battery distribution | `[ ]` | Bar chart of battery % across tracked mesh nodes. Data in `identity` JSON |
| M7 | Data completeness scorecard | `[ ]` | % aircraft with valid speed/heading, % vessels with MMSI name. Surfaces per-source data quality |
| M8 | WebSocket reconnect timeline | `[ ]` | Track client connect/disconnect events over time. Useful for connectivity diagnostics |

---

## New Feed Sources

| # | Source | Status | Notes |
|---|--------|--------|-------|
| F1 | FAA NOTAMs | `[~]` | Legacy FNS/USNS retired April 2026. Replacement: FAA NMS (nms.aim.faa.gov). New developer API at api.faa.gov requires account. Free alt: NASA Digital Information Platform or FAA SWIM/SCDS (free register). Needs evaluation of NMS API shape before implementing |
| F2 | PIREPs + SIGMETs/AIRMETs | `[ ]` | Pilot turbulence/icing reports + aviation weather advisories. Source: aviationweather.gov. Free, no key. Add to weather poller |
| F3 | METAR/TAF for nearby airports | `[ ]` | Aviation weather at airfield level. Same aviationweather.gov source. More useful than raw NWS obs for airfield ops |
| F4 | NOAA GOES satellite imagery tiles | `[ ]` | IR/visible satellite tiles updated every 10 min. WMS endpoint, no key. Map overlay layer |
| F5 | Personal Weather Stations (Wunderground) | `[ ]` | Hyper-local sensor readings at neighborhood level. Useful if NWS station coverage is sparse |
| F6 | NWWS (National Weather Wire Service) | `[ ]` | Raw NWS text products (warnings, statements, discussions) via TCP. Free, no key. Supplement to RSS-based alerts |
| F7 | USCG NAIS Broadcast | `[ ]` | USCG AIS rebroadcast. Better inland waterway coverage than commercial AIS |
| F8 | GDACS (Global Disaster Alert) | `[ ]` | GeoRSS for earthquakes, floods, cyclones, wildfires above thresholds. Complements USGS seismic |
| F9 | USFS Active Fire perimeters (NIFC) | `[ ]` | Polygon overlays for fire containment lines. Complements existing EONET fire point data |
| F10 | Broadcastify feed metadata | `[ ]` | Listener counts + active feed status for radio streams via Broadcastify API |

---

## Data Collected But Not Displayed

| # | Field | Source | Currently Missing From | Status |
|---|-------|--------|----------------------|--------|
| D1 | `squawk` (emergency codes 7500/7600/7700) | ADS-B identity | Aircraft detail panel | `[x]` Added squawk display with emergency highlighting |
| D2 | `vertical_rate` climb/descent indicator | Observation | Aircraft telemetry tile has value but no color coding | `[x]` Was already displayed; added signed arrow + color |
| D3 | `origin` / `destination` / `phase` | ADS-B identity | Aircraft routing section | `[x]` Already in AircraftOverview; confirmed present |
| D4 | `signal_quality` gauge/trend | Observation | Entity detail panel + metrics page | `[x]` Added to metrics page (M2 above) |
| D5 | `identity.battery_pct` + `identity.snr` | MeshCore identity | No gauge in mesh node detail | `[ ]` |
| D6 | `identity.navigational_status` | AIS identity | Vessel detail panel — nav status not shown | `[ ]` |
| D7 | Stream gauge **flow rate** (cfs) | USGS | Only water level shown; flow data in payload | `[ ]` |
| D8 | Seismic **depth** | USGS events | Not shown in event detail | `[ ]` |
| D9 | APRS symbol codes | APRS identity | All APRS use same icon; symbol should drive icon | `[ ]` |
| D10 | Historical replay UI | `/observations/replay` API | Existed but lacked custom date-range picker | `[x]` Added absolute date/time range mode to PlaybackController |
| D11 | TinyGS satellite name + SNR | TinyGS MQTT | Detail panel is minimal | `[ ]` |

---

## Implementation Session Log

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
