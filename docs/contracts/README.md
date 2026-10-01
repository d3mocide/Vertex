# Feed Contracts

A **contract** is the normalized shape of one kind of regional feed. The frontend and the AI briefing depend on contracts, never on a specific agency, so any provider (built in today, region pack tomorrow) that fills a contract works everywhere. See [Region Packs and Location Portability](../architecture/region-packs.md) for the bigger picture.

These are **v0** specs, reverse-engineered from what the poller publishes and the UI consumes today, and each JSON Schema in [`schemas/`](https://github.com/d3mocide/Vertex/tree/main/docs/contracts/schemas) validates a live payload. They will tighten as the provider interface lands.

## Conventions

- A contract is published to a Redis feed key and served by the backend; feed age is tracked in `feed:meta`.
- List contracts are JSON arrays; map contracts are GeoJSON FeatureCollections with a few extra top-level keys.
- Fields marked *required* must always be present. Everything else is optional, and consumers must tolerate absence.
- `dist_km` is distance from the region center, computed by the provider.
- Agency wording (for example `severity`) is display-only. Anything the UI branches on has a normalized field (`kind`, `scope`, `status`).
- Times are ISO 8601 strings unless noted.
- Coming with the provider interface: a provenance envelope on every payload (`provider_id`, `attribution`, `fetched_at`).

## Contracts

| Contract | Feed key(s) | Built-in provider | Schema |
|----------|-------------|-------------------|--------|
| `traffic.incidents` | `traffic:incidents` | ODOT TripCheck | [schema](schemas/traffic.incidents.schema.json) |
| `traffic.cameras` | `traffic:cameras` | ODOT TripCheck | [schema](schemas/traffic.cameras.schema.json) |
| `traffic.signs` | `traffic:signs` | ODOT TripCheck | [schema](schemas/traffic.signs.schema.json) |
| `traffic.corridors` | `traffic:corridors`, `traffic:flow` | ODOT TripCheck | [schema](schemas/traffic.corridors.schema.json) |
| `roadwx.stations` | `weather:rwis` | ODOT TripCheck | [schema](schemas/roadwx.stations.schema.json) |
| `outages.areas` | `utility:outages`, `utility:oregon` | Oregon ODIN | [schema](schemas/outages.areas.schema.json) |
| `transit.vehicles` | `transit:vehicles` | Shared GTFS engine | [schema](schemas/transit.vehicles.schema.json) |
| `transit.routes` | `transit:routes` | Shared GTFS engine | [schema](schemas/transit.routes.schema.json) |
| `fire.danger` | `fire:danger` | ODF fire danger | [schema](schemas/fire.danger.schema.json) |

`GET /api/v1/capabilities` reports, for each of these, whether a provider applies to your region and how fresh its data is.

## `traffic.incidents`

One item per closure or delay.

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | *required* |
| `description`, `location`, `link` | string | display text and a link back to the agency |
| `pubDate`, `start`, `sched_end` | string | last update, first reported, scheduled end |
| `lat`, `lon`, `dist_km` | number | location and distance from the region center |
| `severity` | string | agency wording, display only |
| `kind` | `closure` \| `delay` \| `low` | normalized impact; what the UI sorts and groups on |
| `scope` | `road` \| `ramp` \| null | ramps fold under the closure they belong to |
| `unplanned` | boolean | crash, hazard, landslide, as opposed to planned work |
| `group`, `lead`, `group_size` | string \| null, boolean, integer | closures within about 2.5 km share a group |
| `event`, `event_sub`, `ramp` | mixed | provider extras, optional |

## `traffic.cameras`

| Field | Type | Notes |
|-------|------|-------|
| `id`, `name`, `url` | string | *required*; `url` is a still image |
| `ldi_url` | string | optional last-daylight image for night cameras |
| `lat`, `lon`, `road`, `dist_km` | | location and road name |
| `health` | `ok` \| `warn` \| `down` \| `unknown` | derived by the provider from image freshness |
| `last_ok_ts` | integer \| null | Unix seconds of the last healthy fetch |

## `traffic.signs`

| Field | Type | Notes |
|-------|------|-------|
| `id`, `name`, `text`, `kind` | | *required*; `kind` is `message`, `speed` or `travel` |
| `route`, `dist_km` | | |
| `page1`, `page2` | string[] | the sign's message pages, one string per line |

## `traffic.corridors`

Summarized from detector flow. Which roads count as corridors comes from the region pack.

| Field | Type | Notes |
|-------|------|-------|
| `road`, `dir`, `label`, `status` | | *required*; `dir` is `N`/`S`/`E`/`W`; `status` is `normal` or `slow` |
| `speed` | integer | corridor speed in mph |
| `stations`, `reporting` | integer | detectors defined and currently reporting |
| `slowest` | object | `{loc, speed}` of the slowest detector |

## `roadwx.stations`

| Field | Type | Notes |
|-------|------|-------|
| `id`, `name`, `lat`, `lon` | | *required* |
| `route`, `elev_ft`, `dist_km`, `updated` | | |
| `temp_f`, `dew_f`, `surface_f`, `humidity`, `wind_mph`, `gust_mph`, `visibility_m`, `precip` | number \| null | null when the sensor is not reporting |

## `outages.areas`

A GeoJSON FeatureCollection of polygons, with top-level `updated`, `near` (areas nearest the region center), `near_radius_km`, `coverage`, and `utilities`. Utility rows carry stable provider-prefixed IDs, name, state, coverage label, total and nearby meters out, county names and attribution. Totals describe the publisher’s coverage and may include areas beyond the map’s distance cutoff. Missing updates indicate unknown status, not zero outages.

| Feature property | Type | Notes |
|------------------|------|-------|
| `utility`, `meters_out` | | *required* |
| `county`, `meters_served`, `tract`, `dist_km`, `lat`, `lon` | | |

The UI uses the per-utility list in `utility:outages`. Older `utility:oregon` and `utility:pge` feeds remain compatibility aliases. Provider snapshots merge without overwriting one another; no Washington outage provider is declared until a supported source is available.

## `fire.danger`

A GeoJSON FeatureCollection of danger zones, with top-level `fetched_at` and `nearby` (zones closest to the region center: `zone`, `district`, `danger`, `label`, `dist_km`).

| Feature property | Type | Notes |
|------------------|------|-------|
| `zone` | string | *required* |
| `danger` | integer | *required*; 1 is lowest |

## Adding or changing a contract

1. Write or update the JSON Schema in `docs/contracts/schemas/` and the table above.
2. Add the contract to `backend/capabilities.py` so `/api/v1/capabilities` reports it.
3. Check a real payload validates against the schema.
4. Update the frontend types and consumers, and note the change in `TASK_LOG.md`.

## Transit contracts

`GET /api/v1/transit/vehicles` returns the merged, locally filtered measured bus/train
snapshot. Entity IDs are feed-prefixed; legacy TriMet vehicle IDs remain stable.
Coordinates and speed/heading come from vehicle positions, never schedule estimates.
Speed is knots in the entity contract; bus details convert to mph for display.
`position_ts` is null and `position_stale` true when measurement time is absent;
`identity.measurement_time_known` makes that uncertainty explicit. Both known vehicle
fixes and feed timestamps have a 90-second freshness limit, with 30 seconds allowed
for publisher clock skew. A successful full empty snapshot clears its own agency's
vehicles; failed requests retain last-known data until the 120-second live TTL.

`GET /api/v1/transit/routes` returns combined route MultiLineStrings clipped to the
monitoring bbox, with feed-prefixed feature IDs, agency/provider attribution and raw
route IDs for realtime joins. It describes the scheduled network, not current service
or vehicle locations. Stops identify relevant routes when shapes are absent; a route
without shapes has no invented line geometry. Calendar and arrival contracts are future
work. `GET /api/v1/rail/gtfs-shapes` remains a compatibility alias for rail geometry only.

Static indexes refresh daily and are cached across poller restarts. Source-specific
metadata preserves independent ages when another agency refreshes the merged feed.
Fixtures use synthetic identifiers and the generic example location.
