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

## Start

```bash
docker compose -f infra/nominatim/docker-compose.yml up -d
docker compose -f infra/nominatim/docker-compose.yml logs -f   # wait for "Nominatim is ready"
```

Check it:

```bash
curl "http://<host>:8088/search?street=1221%20SW%204th%20Ave&city=Portland&state=Oregon&format=jsonv2"
```

## Point Vertex at it

In Vertex's `.env`:

```
GEOCODER_URL=http://<host>:8088
```

and restart the poller. Leave `GEOCODER_URL` blank to disable geocoding.

## Updates

The container pulls Geofabrik's daily Oregon diffs automatically
(`UPDATE_MODE=continuous`). To cover SW Washington as well, a second
instance with the Washington extract can be pointed at by a second URL —
not needed for Multnomah/Washington County dispatch.
