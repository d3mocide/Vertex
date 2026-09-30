# Your area pack

List every source (agency, URL, license/terms, whether a key is needed, update cadence) and any known gaps.
See docs/architecture/region-packs.md for the full pack format and contribution steps.

Optional `feeds.news` entries support `rss`; `feeds.alerts` entries support `rss` and `flashalert_xml`.
Each list allows at most 25 feeds, each with a name and public HTTP(S) URL without credentials.
Setup saves these as `source: pack` defaults in `sources.yml` and the database. Existing feeds win
by URL, including disabled settings. Switching packs removes only superseded pack-owned feeds.
Do not put keys, credentials or operator-specific URLs in a public manifest.

Built-in IDs currently supported: `odot-tripcheck`, `oregon-odin`, `odf-fire-danger`,
`wsdot-travel` (requires `WSDOT_API_KEY`) and `wadnr-fire-danger`. Multiple selected packs union their providers and feed defaults.
Adapters remain reviewed application code; arbitrary Python in packs is not executed.
