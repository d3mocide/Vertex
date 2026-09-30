"""WA DNR current danger and burn restrictions, scoped to DNR-protected forestland."""
from datetime import datetime, timezone
import math
import httpx
from arcgis import query_features, spatial_params
from bus import set_feed
from config import settings
from .base import BasePoller
from .odf_fire_danger import _rings, _inside, _distance_km

URL = 'https://gis.dnr.wa.gov/site3/rest/services/Public_Wildfire/WADNR_PUBLIC_WD_WildfireDanger/MapServer/0/query'
FIELDS = 'OBJECTID,FIREDANGER_AREA_NM,FIRE_DANGER_LEVEL_NM,BURN_BAN_LEVEL_CD,BURN_BAN_LEVEL_NM,NOTES_TXT,DNR_REGION_NAME'
# v0 uses four map colours. Preserve the five-level publisher label and rank separately.
LEVELS = {'low': (1, 1), 'moderate': (2, 2), 'high': (3, 3), 'very high': (4, 4), 'extreme': (4, 5)}
SCOPE = 'DNR-protected forestlands; local restrictions may also apply'


def valid_polygon(geometry):
    if not isinstance(geometry, dict) or geometry.get('type') not in {'Polygon', 'MultiPolygon'}:
        return False
    try:
        rings = _rings(geometry)
        return bool(rings) and all(len(ring) >= 4 and all(len(p) >= 2 and
            all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in p[:2])
            and -180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in ring) for ring in rings)
    except (TypeError, IndexError):
        return False


def normalize(features, region):
    mapped, nearby, home = [], [], None
    for f in features:
        p, geom = f.get('properties'), f.get('geometry')
        if not isinstance(p, dict) or not valid_polygon(geom):
            continue
        zone = str(p.get('FIREDANGER_AREA_NM') or p.get('DNR_REGION_NAME') or 'DNR area')
        label = str(p.get('FIRE_DANGER_LEVEL_NM') or 'Unknown')
        level, rank = LEVELS.get(label.casefold(), (0, 0))
        details = {'zone': zone, 'danger': level, 'danger_rank': rank, 'label': label,
            'district_name': str(p.get('DNR_REGION_NAME') or ''), 'burn_ban': p.get('BURN_BAN_LEVEL_NM'),
            'burn_ban_code': p.get('BURN_BAN_LEVEL_CD'), 'notes': p.get('NOTES_TXT'),
            'scope': SCOPE, 'provider_id': 'wadnr-fire-danger', 'attribution': 'WA DNR'}
        mapped.append({'type': 'Feature', 'id': f"wadnr-fire-danger:{p.get('OBJECTID', zone)}",
            'geometry': geom, 'properties': details})
        inside = _inside(region.region_lat, region.region_lon, geom)
        distance = 0 if inside else _distance_km(region.region_lat, region.region_lon, geom)
        entry = {**details, 'dist_km': round(distance, 1)}
        if inside:
            home = entry
        if distance <= 120:
            nearby.append(entry)
    return {'type': 'FeatureCollection', 'features': mapped, 'home': home,
            'nearby': sorted(nearby, key=lambda row: row['dist_km'])[:4],
            'fetched_at': datetime.now(timezone.utc).isoformat()}


class WadnrFireDangerPoller(BasePoller):
    name = 'wadnr_fire_danger'
    interval = 1800

    async def poll(self):
        params = {**spatial_params(settings), 'outFields': FIELDS,
                  'geometryPrecision': 4, 'maxAllowableOffset': 0.003}
        async with httpx.AsyncClient(timeout=60, headers={'User-Agent': 'Vertex/1.0'}) as client:
            features = await query_features(client, URL, params)
        await set_feed('fire:danger', normalize(features, settings), provider_id='wadnr-fire-danger')
