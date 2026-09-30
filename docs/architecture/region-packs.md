# Region Packs and Location Portability

**Status:** design proposal. Nothing in this document is implemented yet; the roadmap items are tracked in [ENHANCEMENTS.md](https://github.com/d3mocide/Vertex/blob/main/ENHANCEMENTS.md).

## The problem

Vertex was built for one place, and it shows. Aircraft, vessels, weather, alerts, earthquakes, fire and radio work anywhere in the US once you set a region. The pages that make a local dashboard feel local do not:

| Capability | Tied to |
|------------|---------|
| Road closures, cameras, message signs, road-weather stations | ODOT TripCheck (Oregon) |
| Power outages | Oregon ODIN |
| Fire-danger overlay | Oregon Department of Forestry |
| Light rail and streetcar | TriMet (the code reads standard GTFS-RT, so it is close to generic) |
| Freeway corridors | A Portland list in the traffic poller |
| Incident geocoding | A Nominatim default of "Oregon" |
| News ranking, camera defaults, labels | Portland-specific text in several files |

Someone outside Oregon gets the map and the national feeds, and empty pages for the rest. The goal is a version of Vertex that a person in any supported area can point at their location and get the equivalent local data, with the local data contributed by the community rather than by one maintainer.

## Goals and non-goals

**Goals**

- A user gives a location and Vertex configures itself: bounding box, weather zones, timezone, and which local data providers apply.
- Regional data lives in **region packs** that anyone can write, test and contribute by pull request without touching core code.
- The UI adapts: a page or card appears only when something feeds it. No blank panels.
- The Oregon code becomes the first pack, with unchanged behavior.

**Non-goals (for now)**

- Outside the US. The national providers Vertex already uses (NWS, USGS, NIFC, FIRMS) are US-centric. The design should not block other countries, but v1 targets the US.
- A plugin marketplace or runtime downloading of code. Packs ship in the repository and are reviewed like any other change.

## Concepts

- **Core capability**: works anywhere the source covers. Examples: ADS-B, AIS, NWS weather and alerts, earthquakes, wildfire perimeters, lightning, stream gauges, P25/mesh/APRS.
- **Contract**: a versioned description of the normalized data one kind of feed produces (for example `traffic.incidents`). The frontend and briefing code depend on contracts, never on a specific agency.
- **Provider**: code or configuration that fetches one upstream source and produces a contract. ODOT TripCheck is a provider of several traffic contracts.
- **Region pack**: a directory that declares where it applies and which providers, defaults and seed data to use there.
- **Capability**: a contract that currently has at least one active provider. The backend reports capabilities; the UI reads them.

## What already exists (the seam)

The architecture already has the right boundary. Pollers write normalized payloads to Redis feed keys (`traffic:incidents`, `traffic:cameras`, `traffic:signs`, `traffic:flow`, `traffic:corridors`, `utility:outages`, `fire:danger`, and others), the backend serves them, and the frontend renders them. Feed freshness metadata already exists (`/health/feeds` and the `feed_update` WebSocket message). A pack provider only has to write the same keys, in the same shape, from a different source.

The work is to make that boundary explicit and stop the contract from leaking Oregon:

- `OregonStatus` in the frontend types has `pge_affected` and `pacificorp_affected` fields. The outage contract must hold a list of utilities, not two named ones.
- The traffic incident type is already mostly generic (`kind`, `scope`, `unplanned`, `group`), which is a good sign. Cameras and signs need the same review.
- The map center and range ring are baked into the frontend at build time from `REGION_LAT`/`REGION_LON`, so changing location means rebuilding the frontend. A portable app needs the region to be **runtime configuration** served by the backend.

## Contracts

Each contract gets a short spec in `docs/contracts/` (JSON Schema plus prose) and a version. Draft list, from what the UI consumes today:

| Contract | Consumers | Notes |
|----------|-----------|-------|
| `traffic.incidents` | Infrastructure, Incidents, briefing, map | closures/delays with `kind`, `scope`, `unplanned`, location, start and scheduled end |
| `traffic.cameras` | Infrastructure, map | id, name, image URL, lat/lon, road, health |
| `traffic.signs` | Infrastructure | message text lines, kind (`message`/`speed`/`travel`), location |
| `traffic.corridors` | Infrastructure | per-corridor speed and slowest point; corridor definitions come from the pack |
| `roadwx.stations` | Infrastructure, Environment | road-weather stations |
| `outages.areas` | Infrastructure, map, briefing | areas with customers affected, per-utility totals as a list |
| `transit.vehicles` | map | positions for one or more agencies (GTFS-RT covers this) |
| `fire.danger` | Environment, map | danger level polygons or zones |
| `news.local` | Intel | not a contract problem: it is a list of feeds plus a ranking hint from the pack |
| `alerts.local` | Alerts | local emergency-management RSS/CAP feeds |

Every payload carries provenance: `provider_id`, `attribution`, and `fetched_at`, so the UI can credit the source and show staleness honestly.

## Providers

A provider has a small, fixed interface:

```python
class Provider(ABC):
    id: str                 # "odot-tripcheck"
    provides: list[str]     # contract names, e.g. ["traffic.incidents", "traffic.cameras"]
    interval: int           # seconds between polls

    async def setup(self, ctx): ...      # read config, validate keys
    async def poll(self, ctx) -> dict:   # contract name -> normalized payload
```

`ctx` gives access to the region (bbox, center, timezone), the pack's configuration, an SSRF-guarded HTTP client, and the feed writer. The poller runs providers on the existing `BasePoller` heartbeat so metrics, backoff and health reporting come for free.

**Declarative providers first.** Most regional data arrives in a handful of standard shapes, so most packs should need no Python at all:

| Kind | Covers |
|------|--------|
| `gtfs_rt` | Any transit agency publishing GTFS-Realtime (TriMet already does) |
| `arcgis_featureserver` | The many state and utility open-data layers on ArcGIS (Oregon's ODIN outage layer is one) |
| `rss` / `cap` | News and local emergency feeds |
| `wzdx` | Work-zone data feeds, a US standard that many state DOTs publish (coverage varies by state) |
| `json_rest` | A JSON API with a field mapping and optional key header |

A declarative provider is a manifest entry with a URL and a field mapping. When an upstream does not fit (ODOT's inventory-plus-flow joins are an example), a pack can ship a Python provider. Python providers get more review, since they run inside the poller.

## Region pack format

```
regions/
  oregon/
    pack.yml
    providers/            # optional Python providers
    corridors.yml         # freeway corridor definitions
    geofences.yml         # optional seed zones (label-only areas)
    fixtures/             # recorded upstream responses for tests
    README.md             # sources, keys, coverage, known gaps
```

`pack.yml` (sketch):

```yaml
schema: 1
id: oregon
name: Oregon
maintainers: [github-handle]

covers:                    # used to suggest a pack for a location
  states: [OR]
  bbox: [-124.7, 41.9, -116.4, 46.3]

requires_keys:             # surfaced in the setup wizard
  - name: ODOT_API_KEY
    where: developer.odot.state.or.us
    free: true

defaults:
  geocoder_state: Oregon
  news_ranking: portland-metro       # optional named hint

providers:
  - id: odot-tripcheck
    kind: python
    entry: providers/odot_tripcheck.py
    provides: [traffic.incidents, traffic.cameras, traffic.signs, roadwx.stations]
    interval: 60
  - id: oregon-odin
    kind: arcgis_featureserver
    provides: [outages.areas]
    url: https://example.invalid/arcgis/.../FeatureServer/0   # real URL in the pack
    mapping: { customers: CustomersAffected, utility: UtilityName, geometry: geometry }
  - id: trimet
    kind: gtfs_rt
    provides: [transit.vehicles]
    route_types: [0, 1, 2]

feeds:
  news:   [ { name: "Example Local News", url: "https://example.invalid/rss" } ]
  alerts: [ { name: "County Emergency Mgmt", url: "https://example.invalid/rss" } ]
```

**Precedence, highest first:** environment variables, then the user's `config/sources.yml`, then the pack defaults. A user can always override or disable any provider.

**Secrets never live in packs.** A pack names the keys it needs; the values stay in `.env`.

**Privacy:** packs describe places, not people. No personal coordinates, devices or credentials. The pack check (below) rejects them.

## Capability discovery and UI behavior

The backend exposes the resolved state:

```
GET /api/v1/capabilities
{
  "region": { "name": "...", "center": [lat, lon], "bbox": [...], "timezone": "..." },
  "pack": "oregon",
  "contracts": {
    "traffic.incidents": { "providers": ["odot-tripcheck"], "status": "ok", "updated": "..." },
    "outages.areas":     { "providers": [],                 "status": "none" }
  }
}
```

`status` is `ok`, `stale`, `down`, `pending` (enabled, no data yet) or `none` (no provider applies), built on the existing feed freshness tracking (`feed:meta`). `none` carries a `reason` such as `not_configured` (a required key is missing) or `outside_coverage`. The frontend reads this once and:

- hides cards and map layers whose contract has no provider (`none`), and shows a short, honest empty state on a page that would otherwise be blank ("No road-condition provider for your area yet. Region packs are how this gets added.");
- keeps a card visible but flags it when a provider is `stale` or `down`;
- links from the empty state to the pack authoring guide.

This works before any packs exist: a non-Oregon user immediately gets a clean app instead of blank Oregon pages.

## Setup wizard (implemented)

Region is chosen **once, in a setup wizard**, not through a live-reloading setting. The wizard is driven by the packs installed under `regions/`:

1. **Location.** Click the map, use the device location, or type coordinates. Coordinates stay on the operator's server.
2. **Region.** For US locations `POST /api/v1/config/region/resolve` asks the NWS `points` API for the forecast office, forecast/county/fire zones, timezone and a name; the operator can edit all of it. Outside the US the lookup fails politely and the operator fills the details in.
3. **Region pack.** `GET /api/v1/setup/packs` lists installed packs, with those covering the location first (by bounding box or US state). Invalid packs are shown greyed with the reason. "Core feeds only" is always offered and is the default when nothing covers the location.
4. **Keys.** The chosen pack's `requires_keys` are listed with `found`/`missing` status. Keys are never entered in the app: the operator adds them to `.env`, and features that need a missing key stay off (capabilities reports `not_configured`).
5. **Review and save.** `PUT /api/v1/config/region` stores the region, timezone, NWS identifiers and chosen pack.

It runs automatically on first sign-in when nothing has chosen a region (admins see the wizard; other users see a "setup not finished" message), and admins can reopen it from Settings, Region setup.

**No live reload.** The poller reads the region once, at startup:

- On a fresh install (no `REGION_LAT`/`REGION_LON`, nothing saved) the poller **waits** at the gate until the wizard saves a region, so it never fills the database with data for the wrong place. It proceeds by itself the moment the region is saved. `SETUP_GATE=false` skips the wait and uses the built-in defaults.
- Changing the region later means running the wizard again and restarting the poller. The setup screen reports `restart_required` by comparing the region the poller applied (published to Redis at startup) with the one stored.
- Environment variables still win: with `REGION_LAT`/`REGION_LON` set the region is pinned, the wizard warns about it, and saving is refused with a `409`.

**Packs and capabilities.** A chosen pack narrows which contracts are active: contracts the pack does not provide report `none` with reason `not_in_pack`; "core feeds only" reports `no_pack`; an install with no pack (older installs, and installs configured through the environment) keeps every built-in provider. The pollers themselves still all run for now; stopping the ones a pack does not use arrives with the provider registry (phase 2).

**Not yet applied by the wizard:** a pack's news and alert feeds, NWS alert zones (stored in `alert_zone_configs`/`sources.yml`) and the climate station (`NWS_CLIMATE_STATION`). They are the next additions to the setup flow.

## Runtime region (implemented)

- **Endpoints:** `GET /api/v1/config/region` returns the region in force (name, center, bounding box, timezone, NWS identifiers, pack), its `source` (`env`, `database` or `default`), and whether it is `locked` by the environment. `PUT` (admin) stores a region and answers `409` naming the variables to remove when `REGION_LAT`/`REGION_LON` are set. `GET /api/v1/setup/status` reports `needs_setup`, the poller's state (`waiting`, `applied`, `env`, `default`) and `restart_required`. (`/config/regions`, plural, is the older list of monitoring regions from `sources.yml`.)
- **Storage:** the `app_settings` table, created automatically on existing installs.
- **Precedence:** environment, then database, then defaults, so existing deployments are unchanged.
- **Backend:** reads the region from the database on each request, so both uvicorn workers agree the moment it is saved; `/capabilities` follows it.
- **Frontend:** loads the region after sign-in, before the dashboard mounts, and falls back to built-in defaults if the backend is unreachable. The build-time `VITE_REGION_*` arguments are gone.

## Contributing a pack

1. Copy `regions/_template/` to `regions/<your-area>/`.
2. Fill in `pack.yml`. Only `builtin` providers are supported so far; declarative kinds (`gtfs_rt`, `arcgis_featureserver`, ...) come next.
3. Record real responses from each upstream into `fixtures/` (strip anything personal).
4. Run the pack check: `make pack-check` (or `python3 backend/packs.py regions`). Today it validates every manifest — required fields, known contract ids, supported provider kinds, key names — and rejects private addresses, personal paths and e-mail addresses. Replaying recorded upstream responses against the contract schemas arrives with declarative providers.
5. Open a pull request. CI runs the same check for every pack.

A pack README lists each source, its license or terms of use, whether a key is needed, update cadence and known gaps. Maintainers are listed so questions have an owner; a pack with no active maintainer can be marked unmaintained rather than deleted.

## Security

Packs can run code in the poller, which has network access. Mitigations:

- packs are reviewed in-repo like any dependency; there is no runtime code download;
- declarative providers run no pack code at all;
- Python providers get the same SSRF-guarded HTTP client as core pollers and may not open their own sockets to private ranges unless the operator has enabled that;
- the pack check flags obvious problems automatically, but review remains the control;
- an operator can mount a private pack directory for unpublished local sources without committing anything.

## Migration plan

| Phase | Outcome | Behavior change |
|-------|---------|-----------------|
| 0 | Contract inventory and specs; `/api/v1/capabilities`; UI hides cards with no provider — **done** ([contracts](../contracts/README.md), `backend/capabilities.py`) | none for Oregon; clean empty states elsewhere |
| 1 | Region moves to runtime config (backend endpoint, DB-backed, env override); frontend stops using build args; NWS-based region resolver — **done** (see below) | none; no more frontend rebuild for a location change |
| 2 | Provider interface and registry; Oregon code moved into `regions/oregon/` behind it; `OregonStatus` replaced by the generic outage contract | none, verified by fixture tests |
| 3 | Declarative providers (`gtfs_rt`, `arcgis_featureserver`, `rss`/`cap`, `wzdx`, `json_rest`); pack loader; `make pack-check`; CI | none |
| 4 | Setup wizard and pack suggestion — **wizard done**; a second pack from a different kind of region to prove the abstraction is still to do | new setup flow |
| 5 | Pack authoring guide, `_template` pack, contribution docs | docs only |

The order matters: phase 0 and 1 help every non-Oregon user immediately and de-risk the rest, and phase 2 must not change Oregon behavior.

## Decisions

Settled 2026-09-29:

1. **Packs live in the repository** under `regions/`, with an optional mounted directory for private packs (unpublished local sources). A repository per pack remains possible later.
2. **Declarative providers first; Python providers are allowed after review.** Most packs should need only a manifest; a Python provider gets closer review because it runs inside the poller.
3. **Order of work: phases 0 and 1 first** (capabilities and runtime region config), because they help every non-Oregon user immediately and do not change Oregon behavior.
4. **Region is chosen once, in a setup wizard driven by the installed packs; no live reload** (added 2026-09-29). The poller waits for the wizard on a fresh install and reads the region only at startup; changing it later means re-running the wizard and restarting the poller.

## Open questions

- **How much do packs own the UI?** Recommendation: none. Packs supply data and terminology through contracts; they do not ship frontend code.
- **Terminology.** Agency and dispatch-unit naming differs by region (the radio incident extractor uses local unit and street conventions). Do we need a per-pack vocabulary file, or a generic extractor with pack hints?
- **Radio.** Talkgroup lists and trunked-system details are region-specific. Should packs seed talkgroups the way they seed geofences?
- **Outside the US.** What is the minimum contract set that makes a non-US install useful (ADS-B, AIS, weather from a national service), and what replaces NWS-specific setup?
- **Licensing.** Some upstream data has terms that restrict redistribution or require attribution. The `attribution` field covers display; do packs also need a declared license?
- **Versioning.** How do contract versions and pack schema versions evolve without breaking old packs?
