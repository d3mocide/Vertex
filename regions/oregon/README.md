# Oregon pack

| Source | Provides | Key | Notes |
|--------|----------|-----|-------|
| ODOT TripCheck | incidents, cameras, message signs, freeway corridors, road-weather stations | `ODOT_API_KEY` (free) | Freeway corridors remain the Portland-area list in the reviewed Oregon adapter |
| Oregon ODIN | power-outage areas | none | Customers and area only; the source does not publish cause |
| ODF | fire-danger zones | none | |
| TriMet | local route shapes and live bus/rail entities | `TRIMET_APP_ID` | Official GTFS Schedule and keyed VehiclePositions API; Portland service area |
| Cherriots | local route shapes | none | Official published GTFS Schedule; Salem service area; no live positions claimed |
| KOIN / OPB | local news RSS | none | Portland-area / statewide reporting |
| FlashAlert Emergency Newswire | emergency XML | none | Regional newswire; not an Oregon-only feed |
| TVF&R | emergency-alert RSS | none | Portland metro fire district; not statewide coverage |

Selecting this pack in setup adds its news and alert feeds to `config/sources.yml` and the database.
They carry `source: pack`; existing operator feeds (matched by URL) win, including disabled feeds.
Re-saving does not duplicate feeds. Switching packs or choosing core feeds only removes pack-owned
feeds that the new selection does not include; operator-owned feeds remain. On an existing install,
restart the poller after saving, as reported by the setup screen.

Feed subscriptions use the publishers' public RSS/XML endpoints; no redistribution license is implied.
News and emergency feeds are checked on the existing 60-second poller cadence. Upstream availability
is reported by the normal feed-health machinery; empty emergency feeds can be quiet.

Reviewed ODOT, ODIN, ODF and transit source configurations live in `adapters/`; the shared registry selects them at startup. Fixed reviewed imports execute Python; manifests and private packs cannot select executable modules. The common GTFS engine clips route shapes and filters measured vehicle positions to the monitoring bounds. Schedules describe the published network, not confirmed current service.

Select Oregon and Washington together for border monitoring. Selecting packs does not change the map center. TriMet requires its official developer AppID; `TRIMET_GTFS_ENABLED=false` remains an explicit disable, and `TRIMET_ROUTE_TYPES` selects modes (default `0,1,2,3`, including buses). Keep keys in the operator environment. Portland-specific radio/geocoding terminology remains a separate roadmap item.
