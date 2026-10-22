# Writing a region pack

A **region pack** tells Vertex what local data exists for an area: which agencies publish traffic, fire danger, outages and transit, where, and what a person has to do to switch each one on. This page is the step-by-step guide. The format itself is defined by `regions/_template/pack.yml` (the authoritative copy) and the design is in [Region Packs and Location Portability](region-packs.md).

A pack is a directory with one `pack.yml` and, optionally, a README. Nothing in a pack is ever executed: the manifest is validated data, and reviewed code in the repo reads it.

## 1. Start from the template

```bash
cp -r regions/_template regions/colorado     # the directory name must equal the pack's id
```

Set `id`, `name`, `description`, `maintainers` and `covers`. `covers.bbox` is `[min_lon, min_lat, max_lon, max_lat]` and is what a declarative provider uses as its coverage; `covers.states` (two-letter codes) is what the setup wizard uses to suggest the pack.

## 2. Say which keys the operator needs

List every key under `requires_keys` with the environment variable name, where to get it, whether it is free, and which contracts it unlocks. Values never go in a pack.

## 3. Add feeds (optional)

`feeds.news` and `feeds.alerts` are RSS (or FlashAlert) URLs added to the operator's `sources.yml` when they choose the pack.

## 4. Describe providers

Each entry in `providers` fills one or more **contracts** (`docs/contracts/`), the normalized shapes the UI and the briefing read. A provider is one of:

| `kind` | What it is |
|--------|-----------|
| `builtin` | Code that lives in the repo and is selected by id. Only for sources that need real logic (the keyed Traveler API, TriMet). |
| `arcgis_featureserver` | A public ArcGIS layer described entirely in the manifest. Today it fills `fire.danger`. |
| `gtfs_rt` | A transit agency's GTFS schedule and, optionally, its GTFS Realtime vehicle feed. Fills `transit.routes` and `transit.vehicles`. |

### `arcgis_featureserver` for `fire.danger`

```yaml
- id: wadnr-fire-danger
  kind: arcgis_featureserver
  provides: [fire.danger]
  url: https://gis.dnr.wa.gov/site3/rest/services/Public_Wildfire/WADNR_PUBLIC_WD_WildfireDanger/MapServer/0
  attribution: WA DNR
  refresh_minutes: 30
  fields:
    id: OBJECTID
    zone: [FIREDANGER_AREA_NM, DNR_REGION_NAME]
    level: FIRE_DANGER_LEVEL_NM
  levels:
    low:       {danger: 1, rank: 1}
    moderate:  {danger: 2, rank: 2}
    high:      {danger: 3, rank: 3}
    very high: {danger: 4, rank: 4}
    extreme:   {danger: 4, rank: 5}
  extra:
    burn_ban: BURN_BAN_LEVEL_NM
    notes: NOTES_TXT
  scope: DNR-protected forestlands; local restrictions may also apply
```

| Field | Meaning |
|-------|---------|
| `url` | `https` address of the layer, ending `/FeatureServer/<n>` or `/MapServer/<n>`, with no query string or credentials. It must be on a public host. |
| `attribution` | The agency's name (up to 40 characters), shown beside the data. |
| `refresh_minutes` | 5 to 1440, default 30. |
| `fields.zone` | The field holding the zone's name, or a list tried in order. |
| `fields.level` | The field holding the danger level, as words or codes. |
| `fields.id` | Optional unique field, used to keep zones distinct. |
| `levels` | The agency's wording or codes (case-insensitive) mapped to `danger` 1 to 4, which is the map colour. `rank` (1 to 5, default the same as `danger`) keeps an agency's finer levels apart, and `label` replaces the wording shown. |
| `extra` | Extra detail kept on each zone, as output name to service field. `burn_ban` and `notes` are shown in the fire card. |
| `scope` | A sentence shown with the burn restriction, for example whose land it covers. |
| `skip_unknown` | `true` drops a zone whose level is not in `levels`; otherwise it appears as not rated with the agency's own wording. |

Find the field names by opening the layer's URL in a browser (the REST page lists every field) and the `?f=pjson` view. The layer must be reachable without a key.

### `gtfs_rt` for `transit.routes` and `transit.vehicles`

```yaml
requires_keys:                     # only if the agency's realtime feed needs a key
  - {name: PACK_METRO_TRANSIT_KEY, where: https://transit.example.org/developers, free: true, unlocks: [transit.vehicles]}
providers:
  - id: metro-transit
    kind: gtfs_rt
    provides: [transit.routes, transit.vehicles]    # routes only, if there is no realtime feed
    attribution: Metro Transit
    static_url: https://transit.example.org/gtfs.zip
    realtime_url: https://transit.example.org/realtime/vehicle-positions.pb
    key: {env: PACK_METRO_TRANSIT_KEY, param: apikey}
    coverage: [-105.5, 39.5, -104.5, 40.1]          # min_lon, min_lat, max_lon, max_lat of the service area
```

| Field | Meaning |
|-------|---------|
| `static_url` | `https` address of the GTFS schedule ZIP, on a public host, with no query string or credentials. |
| `realtime_url` | Optional `https` address of the GTFS Realtime vehicle positions feed (protocol buffers). Needed for `transit.vehicles`, and only allowed with it. |
| `alerts_url` | Optional `https` address of the agency's GTFS Realtime service alerts feed, with the same rules as the other URLs. Alerts for routes in the monitored area, and agency-wide notices, appear in the transit card and on the route. Allowed on a schedule-only provider. |
| `attribution` | The agency's name (up to 40 characters), shown beside its routes and vehicles. |
| `key` | Optional, realtime and alerts feeds. `env` is the environment variable holding the key and `param` the query parameter the agency expects it in. `env` must be listed under `requires_keys` and must start with `PACK_` (two older reviewed names, `TRIMET_APP_ID` and `SOUNDTRANSIT_API_KEY`, are also accepted). A pack cannot name any other variable, so it cannot read Vertex's own secrets. |
| `coverage` | The agency's service area. Vertex downloads the schedule only when the monitored area overlaps it. Defaults to the pack's `covers.bbox`, which is usually a whole state and far too wide for a single agency, so set it. |
| `route_types` | Optional list of GTFS `route_type` numbers to show (0 tram, 1 subway, 2 rail, 3 bus). Default: all. |
| `poll_seconds` | 15 to 3600, default 30. How often the vehicle feed is read. The schedule refreshes daily. |

Use the agency's own published feed and respect its terms; there is no scraping. The first schedule download for a large agency takes a while and is cached for a day. A route in a schedule is not evidence that it runs today, and a schedule alone gives no live positions.

### `wzdx` for `traffic.incidents`

Many US state DOTs publish road work as a [Work Zone Data Exchange](https://github.com/usdot-jpo-ode/wzdx) (WZDx) GeoJSON feed; the USDOT keeps a [registry of them](https://datahub.transportation.gov/Roadways-and-Bridges/Work-Zone-Data-Exchange-WZDx-Feed-Registry/69qe-yiui). One provider block is enough to list that work as incidents:

```yaml
requires_keys:                                  # only when the feed needs a key
  - {name: PACK_EXAMPLE_WZ_KEY, where: https://dot.example.org/developers, free: true, unlocks: [traffic.incidents]}
providers:
  - id: example-workzones
    kind: wzdx
    provides: [traffic.incidents]
    url: https://dot.example.org/wzdx/feed       # https, public, no query string
    attribution: Example DOT
    link: https://dot.example.org/map            # optional: where an incident's "details" link goes
    # key: {env: PACK_EXAMPLE_WZ_KEY, param: api_key}
    # coverage: [-105.5, 39.5, -104.5, 40.1]     # optional; defaults to the pack's covers.bbox
    # poll_seconds: 300                          # optional, 60 to 3600
```

Keys follow the same rules as for `gtfs_rt`. Vertex reads WZDx v3 and v4 feeds and lists a work zone when it is inside the monitored area, not completed or cancelled, not ended and not scheduled more than a day ahead, and it affects traffic. The agency's own `vehicle_impact` decides that: lanes closed or alternating traffic is listed (all lanes closed becomes a closure), "all lanes open" is not, and a zone that does not say is listed only once its `event_status` is `active`, so a long contract that is merely scheduled does not flood the list. Work zones are never marked as unplanned events, and nearby closures group like any other provider's. Detours are not listed. A feed larger than 8 MB is refused.

## 5. Check your pack

```bash
make pack-check          # validates every pack under regions/ with the backend image
```

The validator rejects anything unsafe or incomplete with a one-line reason: private addresses, personal paths or e-mail addresses, `http` URLs, URLs with credentials, unknown contracts, a provider id that clashes with an existing one. It also runs in CI.

To see your provider work against the live service, select the pack in the setup wizard on a development install and watch the Region page in the admin console. A provider shows `pending` until its first successful poll.

## 6. Open a pull request

Include the pack directory only. Say which agency publishes the data and link to its terms of use. A reviewer will check the URL, the attribution and that the level mapping matches the agency's own definitions.

## What is not declarative yet

Traffic cameras, signs and outages, and incidents that are not WZDx work zones, still need a `builtin` provider. The next declarative kind planned is `json_rest`. Some things stay built in on purpose: Oregon's forestry feed and TriMet, because installs that never chose a pack still use them (and TriMet's URLs, route types and interval are operator settings), and C-TRAN, whose access terms are unverified. Calendar filtering is not part of `gtfs_rt` yet.
