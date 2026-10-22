"""Fire danger by zone from any public ArcGIS layer, described by a region pack's manifest.

The pack names the layer, the fields holding the zone name and danger level, and how the agency's wording maps to the
four-colour danger scale (see regions/_template/pack.yml and docs/architecture/region-pack-authoring.md). Nothing from the
pack is executed: the manifest is validated data, this reviewed code reads it.
"""
from datetime import datetime, timezone

import httpx

from arcgis import query_features, spatial_params
from bus import set_feed
from config import settings
from polygons import distance_km, inside, valid_polygon
from .base import BasePoller

_NEARBY_KM = 120
_NEARBY_MAX = 4
_PARAMS = {"geometryPrecision": 4, "maxAllowableOffset": 0.003}   # ~300 m simplification: invisible at map scale


def normalize(features, spec, region, provider_id):
    """The ``fire.danger`` contract from ArcGIS GeoJSON features and a validated provider spec."""
    fields, levels = spec["fields"], spec["levels"]
    mapped, nearby, home = [], [], None
    for f in features:
        props, geom = f.get("properties"), f.get("geometry")
        if not isinstance(props, dict) or not valid_polygon(geom):
            continue
        raw = props.get(fields["level"])
        level = levels.get(str(raw).strip().casefold()) if raw is not None else None
        if level is None and spec["skip_unknown"]:
            continue
        zone = next((str(props[name]) for name in fields["zone"] if props.get(name) not in (None, "")), "Unnamed zone")
        label = (level or {}).get("label") or (str(raw) if raw not in (None, "") else "Unknown")
        details = {"zone": zone, "danger": level["danger"] if level else 0, "danger_rank": level["rank"] if level else 0,
                   "label": label}
        for out, field in spec["extra"].items():
            details[out] = props.get(field)
        if spec["scope"]:
            details["scope"] = spec["scope"]
        details.update({"provider_id": provider_id, "attribution": spec["attribution"]})
        ident = props.get(fields["id"]) if fields["id"] else None
        mapped.append({"type": "Feature", "id": f"{provider_id}:{ident if ident is not None else zone}",
                       "geometry": geom, "properties": details})
        here = inside(region.region_lat, region.region_lon, geom)
        distance = 0 if here else distance_km(region.region_lat, region.region_lon, geom)
        entry = {**details, "dist_km": round(distance, 1)}
        if here:
            home = entry
        if distance <= _NEARBY_KM:
            nearby.append(entry)
    return {"type": "FeatureCollection", "features": mapped, "home": home,
            "nearby": sorted(nearby, key=lambda row: row["dist_km"])[:_NEARBY_MAX],
            "fetched_at": datetime.now(timezone.utc).isoformat()}


class ArcgisFireDangerPoller(BasePoller):
    def __init__(self, provider_id: str, spec: dict):
        self.provider_id, self.spec = provider_id, spec
        self.name = provider_id.replace("-", "_")
        self.interval = spec["refresh_minutes"] * 60

    async def poll(self):
        fields = self.spec["fields"]
        wanted = {name for name in (fields["id"], fields["level"], *fields["zone"], *self.spec["extra"].values()) if name}
        params = {**spatial_params(settings), **_PARAMS, "outFields": ",".join(sorted(wanted))}
        async with httpx.AsyncClient(timeout=60, headers={"User-Agent": "Vertex/1.0"}) as client:
            features = await query_features(client, self.spec["url"] + "/query", params)
        await set_feed("fire:danger", normalize(features, self.spec, settings, self.provider_id), provider_id=self.provider_id)
