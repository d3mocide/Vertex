# Oregon pack

| Source | Provides | Key | Notes |
|--------|----------|-----|-------|
| ODOT TripCheck | incidents, cameras, message signs, freeway corridors, road-weather stations | `ODOT_API_KEY` (free) | Freeway corridors are the Portland-area list in the traffic poller for now |
| Oregon ODIN | power-outage areas | none | Customers and area only; the source does not publish cause |
| ODF | fire-danger zones | none | |

Not yet described here (they arrive with later phases): TriMet transit (`TRIMET_*` settings), local news and
emergency-alert feeds (`config/sources.yml`), and the Portland-specific radio and geocoding vocabulary.
