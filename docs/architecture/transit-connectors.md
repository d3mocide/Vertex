# Local transit connectors — research and implementation

Research date: 2026-10-01. The first shared connector implementation follows this research.

Implemented: reviewed pack-owned source configurations, shared bounded GTFS parsing, locally clipped route geometry, separately typed bus/rail entities, per-agency snapshots and freshness, full-snapshot removal, credential/coverage gates and daily schedule-index caching across restarts. TriMet uses the existing developer AppID; Cherriots supplies schedules only. Sound Transit is configured for its official keyed agency feed but needs a developer key and live verification. C-TRAN remains disabled pending verified access/terms. No HTML scraping or access workaround is used.

Remaining: service alerts, active-calendar filtering, declarative manifest mappings, operator agency selection and verified second-agency live collection. Coarse agency coverage gates avoid irrelevant downloads; actual route shapes/stops and measured positions are then bounded locally. A route in the published schedule is not evidence it operates today.

## Recommended model

Keep one shared GTFS Schedule/GTFS Realtime engine. Region packs declare reviewed
agency feed configurations, not separate parsers. A state pack is a catalog of
potential agencies; it does not mean every agency operates throughout that state.
Activation follows selected packs, explicit agency choices, credentials and local
service coverage. Multiple overlapping agencies may run together across state lines.

GTFS Schedule describes agencies, stops, routes, trips, service dates and optional
route shapes. GTFS Realtime adds vehicle positions, trip updates and service alerts;
these capabilities are independent. Static schedules cannot establish live positions,
and trip predictions must not be presented as measured vehicle coordinates.
Sources: [Schedule reference](https://gtfs.org/documentation/schedule/reference/),
[Realtime reference](https://gtfs.org/documentation/realtime/reference/).

## Publisher findings

| Agency or directory | Verified public documentation | Integration implication |
|---|---|---|
| TriMet | Schedule ZIP plus VehiclePositions, TripUpdate and alerts; AppID required for web services | First migration target; preserve the current rail selection and vehicle IDs |
| C-TRAN | Agency homepage links to GTFS Data; WSDOT directory lists its schedule ZIP | Border-area candidate for stops/routes. A documented public realtime endpoint and reuse terms were not verified; do not promise live bus positions |
| Cherriots | Official developer page publishes a GTFS schedule feed | Useful example of Oregon agencies beyond Portland. Realtime access was not established by this research |
| Puget Sound agencies | Sound Transit documents multi-agency vehicle positions/trip updates through keyed OneBusAway and separate ST service-alert feeds | Strong second-region validation candidate; match realtime and static identifiers exactly and verify which protocol endpoint serves each capability |

Sources: [TriMet GTFS](https://developer.trimet.org/GTFS.shtml),
[TriMet API terms](https://developer.trimet.org/terms_of_use.shtml),
[C-TRAN homepage](https://www.c-tran.com/),
[WSDOT GTFS directory](https://data.wsdot.wa.gov/gtfs/list.html),
[Cherriots developer resources](https://www.cherriots.org/data/),
[Sound Transit downloads](https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd/otd-downloads).

Sound Transit states its consolidated regional schedule will be decommissioned at
the end of 2026. Prefer agency schedules with verified matching realtime IDs;
do not build a new dependency on the retiring consolidated ZIP. Its realtime access
uses a separate API key, not the WSDOT Traveler access code.

TriMet documents route/block/vehicle filters for its vehicle service and says its
GTFS vehicle feed supports those parameters. This can reduce fetched data after
local route selection; it is not a universal GTFS geographic-query API.
Source: [TriMet vehicle parameters](https://developer.trimet.org/ws_docs/vehicle_locations_ws.shtml).

## Hyperlocal selection

1. Use a reviewed agency coverage envelope for inexpensive initial selection.
   Preserve explicit operator choices. Do not use state membership or office address
   as service coverage. Broad feed envelopes are only candidates, not proof.
2. Cache static GTFS and index agency/routes, trips, stops and shapes. Resolve routes
   touching the monitoring bbox with shape-segment intersections, falling back to
   linked stops when shapes are absent. A route can cross the box with no vertex or
   stop inside it. Calendar validity determines whether scheduled service is active.
3. Select all relevant agencies from the selected packs; do not select just the closest
   agency. Border routes remain eligible irrespective of their publisher's home state.
4. Filter measured live vehicle points to the configured monitoring bbox before publish.
   An optional smaller nearby radius can be a presentation setting. Vehicles serving a
   relevant route but currently outside the box should not become local map entities.
5. Scope alerts through route/stop/agency selectors and active periods. An agency-wide
   disruption remains relevant when that agency serves the monitored area.
6. Clip route geometry for display and expire/remove snapshots and live entities when a
   provider is disabled, leaves the area or omits a vehicle from a successful full snapshot.
   A failed fetch retains last-known data with visible age; it does not report an empty system.

Many publishers provide complete network snapshots. Local filtering reduces Vertex's
map and storage load but does not automatically reduce upstream download size. Use
publisher-supported filters where available; respect each source's cadence and terms.

## Discovery

Start with bundled, reviewed agency entries in the Oregon and Washington packs.
Later, offer setup-time candidate discovery using the Mobility Database or Transitland;
verify publisher URLs, available realtime message types, licensing and credentials before
activation. Directory entries and static feeds do not guarantee realtime access. Keep
normal operation independent of a directory service and avoid background activation
of arbitrary discovered endpoints.
Sources: [Mobility Database catalogs](https://github.com/MobilityData/mobility-database-catalogs),
[Mobility Database API](https://mobilitydata.github.io/mobility-feed-api/SwaggerUI/index.html),
[Transitland feed search](https://www.transit.land/documentation/rest-api/feeds).

## Existing Vertex gaps

- `poller/pollers/gtfs_rt.py`: reusable per-feed states and protobuf parser, but only
  TriMet settings build feeds; default modes are rail and every entity is typed train.
  There is no bbox filter or publisher timestamp check before vehicle publication.
- Its outer heartbeat checks task liveness while per-feed errors are caught inside
  tasks. A healthy wrapper can hide a failed feed; source-specific status is required.
- Static data currently parses routes and shapes, not a complete local service index.
  Route lookup should also resolve trip IDs when realtime route IDs are absent.
- `backend/routers/rail.py` reads only the TriMet shape key and caches it for 24 hours.
  Combined selected-source geometry needs attribution, namespaced IDs and invalidation.
- `poller/main.py` always constructs the GTFS collector independently of pack selection.
- Existing feed-prefixed vehicle IDs and live-only publication are useful foundations.
  Preserve legacy TriMet IDs; do not restore high-volume observation writes by default.

## Contracts and implementation order

Proposed independent capabilities: `transit.vehicles`, `transit.routes`,
`transit.stops`, `transit.alerts`; arrivals/trip updates can follow as a separate capability.
Vehicle records need feed/provider/agency IDs, raw vehicle/route/trip IDs, actual mode,
position, measured timestamp, fetch timestamp and provenance. Namespacing by stable
feed identity avoids collisions across agencies; static and realtime ID pairing is explicit.

1. Define the vehicle/route contracts and extract TriMet configuration into the Oregon
   pack. Keep the parser shared, preserve current rail behavior, and add local filtering,
   per-source freshness and provider-controlled lifecycle. Merge shapes across sources.
2. Add a second verified GTFS publisher and multi-agency fixtures. Support bus mode through
   correctly typed entities and Deck.gl presentation before enabling bus feeds such as C-TRAN.
3. Add stop indexes and localized service alerts, then optional discovery in setup.

Validate duplicate IDs across feeds, missing route IDs resolved through trips, absent
shapes, route segments crossing the bbox, service-calendar exceptions, border agencies,
fresh empty snapshots, source failures, missing/stale/future timestamps, feed removal
and migration of current TriMet configuration. Bound download, archive expansion and
parsing sizes; retain DNS-pinned public requests and server-only credentials.

GTFS best practices recommend vehicle/trip data no older than 90 seconds and distinguish
vehicle timestamps from feed timestamps. Treat that as a freshness target, with explicit
per-feed tolerances and unknown age when measurement timestamps are absent. Polling an
old position successfully must not make it current. Initially support FULL_DATASET;
DIFFERENTIAL behavior is unspecified in the current reference.
Sources: [GTFS Realtime best practices](https://gtfs.org/documentation/realtime/realtime-best-practices/),
[Incrementality reference](https://gtfs.org/documentation/realtime/reference/).
