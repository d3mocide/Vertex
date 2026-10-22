#!/usr/bin/env python3
"""Turn a public address-point layer into an OSM change file that Nominatim can import.

OpenStreetMap lacks many house numbers, especially on rural roads. Counties and states publish address points
(the NENA NG911 schema: Add_Number, ADDRESS_FULL, Post_Comm ...) as ArcGIS feature services. This script downloads one
and writes an .osc file with
  * a node per address (addr:housenumber, addr:street, addr:postcode, addr:city), and
  * an addr:interpolation way between neighbouring numbers on the same side of a street, so Nominatim answers a
    number that is missing from the data with a point between its neighbours (as OSM's own interpolation lines do).

Import the result into a running Nominatim with `nominatim add-data --file <out>.osc` (see README.md). Object ids sit in a
reserved range far above OpenStreetMap's, and every object is written as a <modify>, so running the script again and
importing the new file replaces the earlier objects instead of duplicating them. Standard library only.

    address_points_to_osm.py --url <FeatureServer/0> --bbox MIN_LON,MIN_LAT,MAX_LON,MAX_LAT --out oregon.osc
    address_points_to_osm.py ... --county "Clackamas County"        # one county first, to try it

For a big region, write chunked files per county and skip addresses OpenStreetMap already has:

    address_points_to_osm.py --url ... --bbox ... --skip-file osm_addresses.tsv --chunk-dir chunks/ --chunk-size 25000

That writes chunks/NN-<county>-nodes-KK.osc then chunks/NN-<county>-ways-KK.osc, in the order to import them (a county's
nodes before its ways), plus chunks/ORDER listing them. osm_addresses.tsv has one "street<TAB>housenumber" per line, lower case
(the street as OSM's addr:street).
"""
import argparse
import collections
import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from xml.sax.saxutils import quoteattr

ID_BASE = 9_000_000_000_000        # OSM ids are below 2e10; stay clear of them
PAGE = 2000
FIELDS = "OBJECTID,Add_Number,AddNum_Suf,ADDRESS_FULL,ADDRESS_NUMBER_FULL,Post_Comm,Post_Code,Inc_Muni,County"
MAX_GAP_NUMBERS = 200              # interpolate only across this many house numbers
MAX_GAP_METRES = 1600              # ... and only between points this close (the street may bend otherwise)
_UNIT = re.compile(r"\s+(?:unit|apt|suite|ste|bldg|building|space|lot|#)\b.*$", re.I)


def fetch(url: str, county: str | None, bbox):
    """Yield feature dicts in OBJECTID order. Paging by key is fast on these services; a deep resultOffset is not."""
    last = 0
    while True:
        where = f"Add_Number IS NOT NULL AND OBJECTID > {last}"
        if county:
            where += f" AND County = '{county}'"
        data = urllib.parse.urlencode({
            "where": where, "outFields": FIELDS, "outSR": 4326, "returnGeometry": "true",
            "orderByFields": "OBJECTID", "resultRecordCount": PAGE, "f": "json"}).encode()
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url.rstrip("/") + "/query", data), timeout=90) as r:
                    body = json.load(r)
                if body.get("error"):
                    raise RuntimeError(body["error"].get("message"))
                break
            except Exception as exc:
                if attempt == 3:
                    raise
                print(f"retrying after: {exc}", file=sys.stderr)
                time.sleep(5 * (attempt + 1))
        feats = body.get("features") or []
        if not feats:
            return
        for f in feats:
            g = f.get("geometry") or {}
            if "x" in g and (not bbox or (bbox[0] <= g["x"] <= bbox[2] and bbox[1] <= g["y"] <= bbox[3])):
                yield f
        if not body.get("exceededTransferLimit"):
            return
        last = max(int(f["attributes"]["OBJECTID"]) for f in feats)
        print(f"  ... up to OBJECTID {last}", file=sys.stderr)
        time.sleep(0.2)


def street_of(attrs: dict) -> str | None:
    """'4733 Southeast Everett Street' -> 'Southeast Everett Street' (the layer's own street field can omit the type)."""
    full = (attrs.get("ADDRESS_FULL") or "").split(",")[0]
    street = _UNIT.sub("", re.sub(r"^\S*\d\S*\s+", "", full)).strip()
    return street if len(street.split()) >= 2 else None


def housenumber_of(attrs: dict) -> str | None:
    text = (attrs.get("ADDRESS_NUMBER_FULL") or "").strip()
    if not text and attrs.get("Add_Number"):
        text = f"{attrs['Add_Number']}{attrs.get('AddNum_Suf') or ''}".strip()
    return text if re.fullmatch(r"\d+[A-Za-z]?", text) else None


def metres(a, b) -> float:
    dlat = (b[1] - a[1]) * 111_320
    dlon = (b[0] - a[0]) * 111_320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot(dlat, dlon)


def tag(k: str, v: str) -> str:
    return f"<tag k={quoteattr(k)} v={quoteattr(v)}/>"


def build(features, skip: set[tuple[str, str]] | None = None):
    """Address nodes and interpolation pairs from features.

    Returns (nodes, pairs). A node is (id, lon, lat, number, street, postcode, city); a pair is
    (first node id, second node id, 'odd'|'even', street). Addresses in `skip` (street, number) are left out."""
    seen: set[tuple[str, str]] = set()
    nodes: list[tuple[int, float, float, str, str, str, str]] = []
    for f in features:
        a, g = f["attributes"], f["geometry"]
        street, number = street_of(a), housenumber_of(a)
        if not street or not number:
            continue
        key = (" ".join(street.lower().split()), number.lower())
        if key in seen or (skip and key in skip):
            continue                                                  # one point per address (units share a number)
        seen.add(key)
        city = (a.get("Post_Comm") or a.get("Inc_Muni") or "").strip()
        nodes.append((ID_BASE + int(a["OBJECTID"]), g["x"], g["y"], number, street, str(a.get("Post_Code") or "").strip(), city))
    nodes.sort()                                                      # osm2pgsql insists on ids in ascending order

    # Interpolation: consecutive numbers on one side of one street in one town, when a number is actually missing.
    groups: dict[tuple[str, int, str], list] = collections.defaultdict(list)
    for n in nodes:
        if n[3].isdigit():
            groups[(n[4].lower(), int(n[3]) % 2, n[6].lower())].append(n)
    pairs: list[tuple] = []
    for (_street, parity, _city), pts in groups.items():
        pts.sort(key=lambda n: int(n[3]))
        for a, b in zip(pts, pts[1:]):
            gap = int(b[3]) - int(a[3])
            if gap <= 2 or gap > MAX_GAP_NUMBERS or metres(a[1:3], b[1:3]) > MAX_GAP_METRES:
                continue
            pairs.append((a[0], b[0], "odd" if parity else "even", a[4]))
    pairs.sort()
    return nodes, pairs


HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<osmChange version="0.6" generator="vertex-address-points">\n<modify>\n'
FOOTER = "</modify>\n</osmChange>\n"


def write_nodes(nodes, out) -> None:
    out.write(HEADER)
    for nid, lon, lat, number, street, post, city in nodes:
        tags = [tag("addr:housenumber", number), tag("addr:street", street)]
        if post:
            tags.append(tag("addr:postcode", post))
        if city:
            tags.append(tag("addr:city", city))
        out.write(f'<node id="{nid}" version="1" timestamp="2026-01-01T00:00:00Z" lat="{lat:.7f}" lon="{lon:.7f}">{"".join(tags)}</node>\n')
    out.write(FOOTER)


def write_ways(pairs, out) -> None:
    out.write(HEADER)
    for first, second, side, street in pairs:
        out.write(f'<way id="{first}" version="1" timestamp="2026-01-01T00:00:00Z"><nd ref="{first}"/><nd ref="{second}"/>'
                  f'{tag("addr:interpolation", side)}{tag("addr:street", street)}</way>\n')
    out.write(FOOTER)


def convert(features, out, skip=None) -> tuple[int, int]:
    """One file holding the nodes and then the ways (fine for a county; use write_chunks for a big region)."""
    nodes, pairs = build(features, skip)
    buf_nodes, buf_ways = io.StringIO(), io.StringIO()
    write_nodes(nodes, buf_nodes)
    write_ways(pairs, buf_ways)
    out.write(buf_nodes.getvalue().replace(FOOTER, ""))
    out.write(buf_ways.getvalue().replace(HEADER, "", 1))
    return len(nodes), len(pairs)


def load_skip(path: str) -> set[tuple[str, str]]:
    skip = set()
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            street, _, number = line.rstrip("\n").partition("\t")
            if street and number:
                skip.add((" ".join(street.split()), number.split("\t")[0]))
    return skip


def write_chunks(features, chunk_dir: str, chunk_size: int, skip, priority: list[str]) -> None:
    """Per county: node chunks then way chunks, in import order, plus an ORDER file."""
    import os
    os.makedirs(chunk_dir, exist_ok=True)
    by_county: dict[str, list] = collections.defaultdict(list)
    for f in features:
        by_county[(f["attributes"].get("County") or "unknown").strip()].append(f)
    ordered = sorted(by_county, key=lambda c: (priority.index(c) if c in priority else len(priority), len(by_county[c])))
    order: list[str] = []
    for n, county in enumerate(ordered):
        nodes, pairs = build(by_county[county], skip)
        slug = re.sub(r"[^a-z0-9]+", "-", county.lower()).strip("-")
        print(f"{county}: {len(by_county[county])} points, {len(nodes)} new addresses, {len(pairs)} interpolation ways", file=sys.stderr)
        for kind, items, writer in (("nodes", nodes, write_nodes), ("ways", pairs, write_ways)):
            for k in range(0, len(items), chunk_size):
                name = f"{n:02d}-{slug}-{kind}-{k // chunk_size:03d}.osc"
                with open(os.path.join(chunk_dir, name), "w", encoding="utf-8") as out:
                    writer(items[k:k + chunk_size], out)
                order.append(name)
    with open(os.path.join(chunk_dir, "ORDER"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(order) + "\n")
    print(f"wrote {len(order)} chunk files to {chunk_dir}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True, help="ArcGIS FeatureServer layer URL (ending /0)")
    ap.add_argument("--bbox", help="MIN_LON,MIN_LAT,MAX_LON,MAX_LAT to keep (default: everything the service returns)")
    ap.add_argument("--county", help="only this County value, e.g. 'Clackamas County' (to try the import small)")
    ap.add_argument("--skip-file", help="street<TAB>housenumber lines (lower case) for addresses OSM already has; they are left out")
    ap.add_argument("--out", help="output .osc file (one file: nodes then ways)")
    ap.add_argument("--chunk-dir", help="write per-county chunk files here, in import order, with an ORDER file")
    ap.add_argument("--chunk-size", type=int, default=25000, help="objects per chunk file (default 25000)")
    ap.add_argument("--first", action="append", default=[], help="county to import first (repeatable)")
    args = ap.parse_args()
    if not args.out and not args.chunk_dir:
        ap.error("give --out or --chunk-dir")
    bbox = tuple(float(v) for v in args.bbox.split(",")) if args.bbox else None
    skip = load_skip(args.skip_file) if args.skip_file else None
    features = fetch(args.url, args.county, bbox)
    if args.chunk_dir:
        write_chunks(list(features), args.chunk_dir, args.chunk_size, skip, args.first)
        return
    with open(args.out, "w", encoding="utf-8") as out:
        nodes, ways = convert(features, out, skip)
    print(f"wrote {nodes} address nodes and {ways} interpolation ways to {args.out}")


if __name__ == "__main__":
    main()
