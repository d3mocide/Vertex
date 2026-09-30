# Oregon pack

| Source | Provides | Key | Notes |
|--------|----------|-----|-------|
| ODOT TripCheck | incidents, cameras, message signs, freeway corridors, road-weather stations | `ODOT_API_KEY` (free) | Freeway corridors are the Portland-area list in the traffic poller for now |
| Oregon ODIN | power-outage areas | none | Customers and area only; the source does not publish cause |
| ODF | fire-danger zones | none | |
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

Not yet described here (they arrive with later phases): TriMet transit (`TRIMET_*` settings) and the
Portland-specific radio and geocoding vocabulary. Regional providers still use the built-in pollers;
the shared registry now selects ODOT, ODIN and ODF at startup. Moving their code into the pack remains a roadmap step.

Select Oregon and Washington together for border monitoring. Their feeds are combined by URL and
shared cameras are deduplicated. Provider coverage uses the monitoring bounds; selecting another
pack does not change the map center. TriMet remains configured separately until its contract is defined.
