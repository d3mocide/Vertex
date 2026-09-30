# Vertex — Roadmap

Where the project is going and what has shipped. Detailed history lives in `TASK_LOG.md`.
Status: `[ ]` pending · `[~]` in progress · `[x]` done · `[-]` deferred / needs research

---

## Now: Portability and Region Packs

Goal: someone anywhere in the US can give Vertex their location and get the equivalent local traffic, outage, transit and alert data, contributed as community **region packs**. The full proposal is in [docs/architecture/region-packs.md](docs/architecture/region-packs.md).

| # | Item | Status | Notes |
|---|------|--------|-------|
| R0 | Design: contracts, providers, pack format, capability discovery, setup flow | `[x]` | Decisions recorded 2026-09-29: packs in-repo (plus optional private mount), declarative-first with reviewed Python providers, phases 0 and 1 first. Open questions remain at the end of the design doc |
| R1 | Contract inventory and specs (`docs/contracts/`, JSON Schema per feed) | `[x]` | v0 specs for the seven built-in regional contracts, each schema validated against a live payload. Still to spec: transit vehicles (entity-based), news and local alerts |
| R2 | `GET /api/v1/capabilities` and UI empty-state handling | `[x]` | Endpoint plus registry (`backend/capabilities.py`); Infrastructure page cards, Settings layer toggles and the Fire & Smoke danger chip hide when no provider applies; empty state explains why (outside coverage, or a missing key). Removed the fake placeholder cameras. Source-specific stale/down/pending and missing-key notices on Infrastructure/Environment, plus failed freshness-check notices. Remaining: gate the map layers themselves |
| R3 | Region as runtime config (backend endpoint, DB-backed, env override) | `[x]` | `GET/PUT /api/v1/config/region`, `app_settings` table, env > database > defaults; poller applies it at startup, and later changes require an operator restart; frontend loads it after sign-in and no longer uses build-time region args |
| R4 | NWS-based location resolver | `[~]` | `POST /api/v1/config/region/resolve` returns office, forecast/county/fire zones, timezone, name and a default bbox (US only). Nearby observation stations and a climate product location are now resolved and reviewed; setup applies derived zones/stations with environment precedence. Remaining: dedicated airport/METAR suggestions |
| R5 | Provider interface and registry in the poller | `[x]` | Shared reviewed catalog; startup selects ODOT, ODIN, ODF, WSDOT and WA DNR by pack, keys and monitoring bounds. Existing `BasePoller` lifecycle; isolated snapshots, additive traffic and per-source freshness |
| R6 | Move Oregon code into `regions/oregon/` behind the interface | `[ ]` | ODOT TripCheck, ODIN outages, ODF fire danger, TriMet, Portland corridors. Must not change behavior; fixture tests |
| R7 | Generalize the outage contract | `[x]` | Power UI uses attributed per-utility totals and explicit coverage from `utility:outages`; removed Oregon-specific frontend state, retained old backend feeds as compatibility aliases. Merged provider snapshots and schema fixture validated; unknown/stale data cannot imply zero outages |
| R8 | Declarative providers: `gtfs_rt`, `arcgis_featureserver`, `rss`/`cap`, `wzdx`, `json_rest` | `[ ]` | Most packs should need no Python |
| R9 | Pack loader, `make pack-check`, CI validation | `[~]` | Done: manifest v1, loader/validator (`backend/packs.py`), `make pack-check`, private-address/path/e-mail rejection, tests (run in CI with the backend suite). To do: fixture replay against contract schemas once providers are declarative |
| R10 | First-run setup wizard with pack suggestion | `[x]` | Location (map, device location or coordinates), region details from the NWS resolver, pack choice (covering packs first, or core feeds only), key status, review and save. Runs on first sign-in and from the admin console's Region page. The poller waits at a gate (`SETUP_GATE`) on a fresh install; no live reload — a later change needs a poller restart, which the screen reports |
| R11 | A second pack from a different kind of region | `[x]` | Washington uses the keyed WSDOT Traveler API for incidents/cameras and DNR fire danger/burn restrictions. Oregon and Washington can run together; shared cameras and feed subscriptions deduplicate |
| R12 | Pack authoring guide and `_template` pack | `[~]` | `regions/_template/`, an Oregon pack, and a CONTRIBUTING section are in. To do: a step-by-step authoring guide once declarative providers exist |
| R15 | Apply a pack's news and alert feeds during setup | `[x]` | Validated RSS/FlashAlert manifests; setup seeds `sources.yml` and DB as pack-owned defaults, preserves operator/disabled feeds, deduplicates by URL, removes superseded pack feeds, and detects feed-only restart needs. Review lists feed names; poller sync restores pack rows after DB recreation |
| R16 | Derive alert zones and the climate station in the wizard | `[x]` | Review NWS forecast/county/fire zones, nearby observation stations and an inventory-confirmed climate ID. Setup-owned zones reconcile on save/startup; operator/disabled rows and explicit environment settings are preserved |
| R17 | Stop pollers a pack does not use | `[~]` | Seven regional contracts now follow selected providers; disabled provider snapshots are removed on restart. Remaining: define transit contracts and bring separately configured TriMet under selection |
| R13 | Per-pack terminology (radio units, street conventions, agency names) | `[-]` | Depends on how generic the radio incident extractor can be made |
| R14 | Non-US baseline (ADS-B, AIS, national weather service) | `[-]` | Out of scope for v1 |

### Next implementation sequence

1. **R6: Oregon extraction.** The generic outage list and schema fixture have shipped. Move Oregon
   adapters/corridors behind the established registry without changing their payloads.
2. **Finish R17 and R1 for transit.** Define the transit contract and migrate independently configured
   TriMet into provider selection. Keep national/core pollers independent of packs.
3. **R8 + R9 + R12: declarative adapters and authoring.** Generalize the Washington ArcGIS experience
   into a reviewed declarative mapping, replay fixtures against schemas and write an authoring guide.
   Washington outages and keyed Traveler API road-weather/flow extensions need separate mappings and contracts.
4. **R4: dedicated airport/METAR suggestions.** Build on the shipped location-derived NWS zones,
   observation stations and climate choices while preserving explicit operator configuration.

---

## Recently Shipped

Since the May foundations below. See `TASK_LOG.md` for detail.

| Area | What shipped | Status |
|------|--------------|--------|
| Aircraft | ADS-B source arbitration: local BEAST, community feeds (airplanes.live / adsb.fi), OpenSky as a gap-filler with OAuth2; an older position never overwrites a newer one; ultrafeeder JSON standby | `[x]` |
| Aircraft | Roles from registration and owner data (air ambulance, rescue, police, fire, military, news, government), map glow, Notable filter, emergency squawk ring, events | `[x]` |
| Radio | P25 recorder from the OP25 audio websocket, Whisper transcription, deterministic incident extraction, geocoding via self-hosted Nominatim, live in-browser listening across receivers | `[x]` |
| Briefings | Hourly AI briefing with analytic prompt, 7-day baseline, quality metrics, posture rating, history | `[x]` |
| Incidents | Incidents page built on radio-derived dispatch incidents; dispatch map layer with severity and age | `[x]` |
| Infrastructure | Closure triage by scope and event, freeway corridor status, message signs, power outages with weather and lightning context | `[x]` |
| Environment | Regional NWS map clipping; shared NIFC/EONET wildfire reports with state, proximity and containment; contained incidents grouped separately; ODF/WA DNR danger and scoped burn restrictions; weather history, nearby stations, FIRMS and lightning | `[x]` |
| Rail | Amtrak, TriMet GTFS-RT (MAX, WES, Streetcar), rail lines | `[x]` |
| Replay | Time-windowed presence, thinned replay data (was: everything shown forever) | `[x]` |
| Platform | Public DNS for pollers, `REGION_LAT`/`REGION_LON` honoured by the frontend build, `REGION_NAME` in the UI | `[x]` |
| Admin | Health console reworked around "is anything wrong?": an attention banner and service cards on the System tab, data sources judged against their expected interval, entity and dispatch activity instead of per-entity freshness, storage that judges the purge (not a countdown), pool judged against real capacity, events over the last 24 h. Region setup lives in the admin console (Region page). The purge is scheduled from when it last ran, so restarts no longer starve it | `[x]` |
| Project | README rewrite with screenshots and tour video, docs site on GitHub Pages loading the Markdown files, in-app Help refresh, SECURITY / CONTRIBUTING / templates / Dependabot, agent rules consolidated in `CLAUDE.md` | `[x]` |

---

## Open Items

| # | Item | Status | Notes |
|---|------|--------|-------|
| O1 | Power outage cause and restoration time | `[-]` | ODIN gives customers and area only. PGE's outage map uses a Kubra feed that returns 401 without a browser session; PacifiCorp keeps its own. Context (weather, lightning) is shown instead |
| O2 | NASA FIRMS hotspots | `[~]` | Code is live; needs a free `FIRMS_MAP_KEY` in `.env` |
| O3 | Briefing quality tuning | `[~]` | Posture is sometimes over-called ELEVATED; occasional mixing of similar items. Watch `/summary/metrics` |
| O4 | Geocoder misses | `[ ]` | House numbers absent from OSM, suffix-less streets, long-by-long intersections |
| O5 | Link the in-app Help to the docs site | `[ ]` | Help stays user-focused; docs are for setup and development |
| O6 | Document the 3 GB VM footprint and test on a Raspberry Pi 5 | `[ ]` | The Pi is the design target but untested |
| O8 | Entity registry never expires | `[ ]` | The `entities` table keeps every aircraft, node and gauge ever seen (16k aircraft over ~2.5 months, plus ~200 legacy fire incidents from before regional scoping and ~70 legacy USGS gauges). The admin views now separate dormant entities, but pruning the registry (entities with no remaining observations, tags or events) needs a decision |
| O9 | Structurally partial completeness rows | `[-]` | Mesh battery row removed (MeshCore adverts carry no battery field). Remaining: aircraft signal quality only exists for the local receiver (community and OpenSky positions have none). Informational only now; consider dropping or scoping these rows |
| O10 | Static entities write a full observation every poll | `[ ]` | Mesh nodes (about 475 rows per 15 min) and stream gauges (78) record their unchanged position each time, roughly a third of the ~107k observations a day. Recording only on change would cut storage and purge work |
| O7 | Map key and Help stay in sync with the layer code | `[ ]` | Consider a check that flags layer changes without a docs change |

---

## Completed Foundations (May 2026)

### Metrics Page Additions

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| M1 | Per-poller ingestion rate + error rate | `[x]` | Backend queries DB for obs/min per entity_type mapped to poller; `error_count` added to BasePoller heartbeat; PollerGrid shows obs/min + consecutive errors |
| M2 | Signal quality histogram | `[x]` | `Observation.signal_quality` collected but never visualized. New `/admin/signal-quality` endpoint + `SignalQualityChart` component |
| M3 | Entity freshness heatmap | `[x]` | Superseded: per-entity freshness misled (most entities seen in a day are naturally not current). Replaced by Entity Activity (active now, seen in 24 h, hourly shape) and, on the System tab, a data-source table covering every feed |
| M4 | Squawk alert counter widget | `[x]` | `/admin/squawk-alerts` endpoint + `SquawkCounter` widget with color-coded 7500/7600/7700 cards |
| M5 | P25 talkgroup activity chart | `[x]` | `/admin/talkgroup-activity` endpoint + `TalkgroupActivity` horizontal bar chart from p25_call_start events |
| M6 | Mesh node battery distribution | `[-]` | Removed: MeshCore adverts carry no battery field, so there was never data to show (the conditional battery gauges stay for sources that do send it, such as Meshtastic) |
| M7 | Data completeness scorecard | `[x]` | `/admin/data-quality` endpoint + `DataQualityCard` showing % filled per field across entity types |
| M8 | WebSocket reconnect timeline | `[x]` | `WsClientChart` sparkline renders ws_clients from existing metrics history — no new backend needed |

---

### New Feed Sources

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

### Data Collected But Not Displayed

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

## FAA NOTAM Research Notes

The old NOTAM system (FNS/USNS) was fully retired April 2026. The new **NOTAM Management Service (NMS)** is the authoritative source:
- Portal: `https://nms.aim.faa.gov/`
- Developer API: `https://api.faa.gov/s/` — requires account registration + API key
- FAA SWIM/SCDS: `https://scds.faa.gov` — JMS messaging bus, free to register, delivers NOTAM in AIXM/GeoJSON
- Free REST alternative: NASA Digital Information Platform (`https://dip.amesaero.nasa.gov`) redistributes FAA SWIM data
- Third-party: Notamify (`https://notamify.com`) — free tier, V2 archive endpoint publicly accessible

**Recommended approach:** Register for NASA DIP first (no key, REST API), validate coverage, then upgrade to FAA API portal if needed.
