# Local geocoder (Nominatim)

Vertex turns addresses heard on P25 dispatch audio ("1221 SW 4th Ave",
"NW 9th Ave & NW Lovejoy St") into map coordinates with a self-hosted
[Nominatim](https://nominatim.org/) instance, so no dispatch address ever
leaves the local network.

## Requirements

Any always-on machine on the LAN:

| | Import (first start) | Steady state |
|---|---|---|
| RAM | ~3–4 GB | ~1 GB |
| Disk | ~10 GB | ~10 GB |
| Time | 30–90 min | — |

It does not need to run on the Vertex host (a Raspberry Pi or small VM is
usually too tight for the import).

## Region

The compose file defaults to the Oregon extract, matching Vertex's
`.env.example` region. For another area, set these (e.g. in a `.env` next
to the compose file) to any extract from https://download.geofabrik.de/:

```
NOMINATIM_PBF_URL=https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf
NOMINATIM_REPLICATION_URL=https://download.geofabrik.de/north-america/us/washington-updates/
```

and set `GEOCODER_STATE` in Vertex's `.env` to the matching state name.

## Start

```bash
docker compose -f infra/nominatim/docker-compose.yml up -d
docker compose -f infra/nominatim/docker-compose.yml logs -f   # wait for "Nominatim is ready"
```

Check it:

```bash
curl "http://<host>:8088/search?street=1221%20SW%204th%20Ave&state=Oregon&format=jsonv2"
```

## Point Vertex at it

In Vertex's `.env`:

```
GEOCODER_URL=http://<host>:8088
GEOCODER_STATE=Oregon
```

and restart the poller. Leave `GEOCODER_URL` blank to disable geocoding.

## Updates

The container pulls Geofabrik's daily Oregon diffs automatically
(`UPDATE_MODE=continuous`). To cover SW Washington as well, a second
instance with the Washington extract can be pointed at by a second URL —
not needed for Multnomah/Washington County dispatch.


## Web interface

`docker-compose.yml` also builds `nominatim-ui` (the project's own browser interface, pinned and checksum-verified in
`ui/Dockerfile`). Open `http://<nominatim-host>:8089/` for a search box and map; it proxies the API on the same port, so
nothing else is exposed. Its map tiles load from `tile.openstreetmap.org` in your browser; set `Map_Tile_URL` in
`ui/config.theme.js` to use another tile server.

## Adding county address points

OpenStreetMap lacks many rural house numbers. `address_points_to_osm.py` turns a public address-point layer (NENA NG911
schema, an ArcGIS FeatureService; the Oregon pack uses the statewide Oregon Address Points layer) into OSM change files
that `nominatim add-data` imports:

```bash
# addresses OSM already has, so they are not imported twice (run on the Nominatim host)
docker compose exec -u postgres nominatim psql -d nominatim -At -F $'\t' -c "select lower(address->'street'), lower(housenumber) \
  from placex where housenumber is not null and osm_id < 9000000000000 and address ? 'street'" > osm_addresses.tsv

python3 address_points_to_osm.py --url <FeatureServer/0> --bbox=<min_lon,min_lat,max_lon,max_lat> \
  --skip-file osm_addresses.tsv --chunk-dir chunks/ --first "Clackamas County"
```

Copy `chunks/` to the host and import the files listed in `chunks/ORDER`, in order, running
`nominatim add-data --file <chunk> --project-dir /nominatim` (as the `nominatim` user inside the container) and then
`nominatim index` after each. The import is slow (about 20 addresses a second, 13 interpolation lines a second on a
4-core VM) but one-time: the data lives in the volume, survives the nightly OSM updates, and every object has an id above
9 trillion, so re-running a chunk replaces it instead of duplicating it. A full re-import of Nominatim wipes it; merge the
change files into the OSM extract with `osmium apply-changes` before that import to avoid the slow reload.
Addresses missing from the data are interpolated between their neighbours on the same side of the street.
