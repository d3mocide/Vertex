"""Authoritative NIFC/WFIGS current wildfire incidents shared across state borders."""
from datetime import datetime, timezone
from types import SimpleNamespace
import httpx
import math
from arcgis import query_features, spatial_params
from bus import set_feed, publish_entity
from config import settings
from .base import BasePoller
from .fire import _classify_relevance
from .wsdot import _point

URL = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query'
FIELDS = 'OBJECTID,IrwinID,IncidentName,IncidentTypeCategory,ActiveFireCandidate,IncidentSize,PercentContained,ModifiedOnDateTime_dt,POOState'


def _number(value, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return value if maximum is None or value <= maximum else None


def normalize(features, region):
    rows = []
    for f in features:
        p = f.get('properties')
        if not isinstance(p, dict) or p.get('IncidentTypeCategory') != 'WF' or p.get('ActiveFireCandidate') not in (1, True):
            continue
        point = _point(f, region)
        ident = p.get('IrwinID')
        if point is None or not ident:
            continue
        lat, lon, distance = point
        try:
            updated = datetime.fromtimestamp(p['ModifiedOnDateTime_dt'] / 1000, timezone.utc)
        except (KeyError, TypeError, ValueError, OverflowError, OSError):
            updated = None
        rows.append({'id': str(ident).strip('{}').lower(), 'name': str(p.get('IncidentName') or 'Wildfire'),
            'lat': lat, 'lon': lon, 'dist_km': distance, 'updated': updated.isoformat() if updated else None,
            'acres': _number(p.get('IncidentSize')), 'contained_pct': _number(p.get('PercentContained'), 100),
            'state': p.get('POOState'), 'attribution': 'NIFC / WFIGS'})
    return sorted(rows, key=lambda row: row['dist_km'])


class NifcIncidentsPoller(BasePoller):
    name = 'nifc_incidents'
    interval = 600

    async def poll(self):
        # Query the same regional radius used by the existing EONET relevance filter.
        from .fire import _eonet_bbox_url
        from urllib.parse import urlparse, parse_qs
        bbox = parse_qs(urlparse(_eonet_bbox_url()).query)['bbox'][0].split(',')
        # Use the same west,south,east,north envelope as the existing regional query.
        region = SimpleNamespace(region_lat=settings.region_lat, region_lon=settings.region_lon,
            bbox_min_lon=float(bbox[0]), bbox_min_lat=float(bbox[1]),
            bbox_max_lon=float(bbox[2]), bbox_max_lat=float(bbox[3]))
        params = {**spatial_params(region), 'outFields': FIELDS,
                  'where': "IncidentTypeCategory = 'WF' AND ActiveFireCandidate = 1"}
        async with httpx.AsyncClient(timeout=60, headers={'User-Agent': 'Vertex/1.0'}) as client:
            features = await query_features(client, URL, params)
        rows = normalize(features, region)
        await set_feed('fire:nifc_incidents', rows, broadcast=False)
        for row in rows:
            updated = datetime.fromisoformat(row['updated']) if row['updated'] else None
            relevance, distance = _classify_relevance(row['lat'], row['lon'], updated)
            if relevance is None:
                continue
            await publish_entity({'entity_id': 'fire:nifc:' + row['id'], 'entity_type': 'fire_incident',
                'source': 'nifc', 'display_name': row['name'], 'lat': row['lat'], 'lon': row['lon'],
                'altitude': None, 'heading': None, 'speed': None, 'status': 'active',
                'distance_km': round(distance, 2), 'last_seen': row['updated'],
                'identity': {'provider': 'NIFC / WFIGS', 'event_id': row['id'], 'relevance': relevance,
                    'distance_km': round(distance, 2), 'event_ts': row['updated'],
                    'link': 'https://www.nifc.gov/fire-information/maps',
                    'acres': row['acres'], 'contained_pct': row['contained_pct'], 'state': row['state']},
                'tags': ['fire_incident', 'fire_' + relevance]}, ttl=3600)
