"""Bounded, DNS-pinned reads of documented public GIS services."""
import json
import httpx
from security import send_pinned_http_request

MAX_RESPONSE_BYTES = 8 * 1024 * 1024
PAGE_SIZE = 1000
MAX_PAGES = 20
MAX_TOTAL_BYTES = 16 * 1024 * 1024


async def read_json(client, url, *, params=None):
    response = await send_pinned_http_request(client, 'GET', url, stream=True, params=params)
    try:
        response.raise_for_status()
        chunks, size = [], 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > MAX_RESPONSE_BYTES:
                raise ValueError('Response exceeds the size limit')
            chunks.append(chunk)
        return json.loads(b''.join(chunks))
    finally:
        await response.aclose()


async def query_features(client, url, params):
    features, total_bytes = [], 0
    for page in range(MAX_PAGES):
        data = await read_json(client, url, params={**params, 'resultRecordCount': PAGE_SIZE,
            'resultOffset': page * PAGE_SIZE, 'orderByFields': 'OBJECTID'})
        if not isinstance(data, dict) or data.get('error') or data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list):
            raise ValueError('GIS service did not return a feature collection')
        batch = data['features']
        if not all(isinstance(f, dict) for f in batch):
            raise ValueError('GIS service returned malformed features')
        properties = data.get('properties') or {}
        if not isinstance(properties, dict):
            raise ValueError('GIS service returned malformed pagination')
        more = data.get('exceededTransferLimit') or properties.get('exceededTransferLimit')
        total_bytes += len(json.dumps(batch).encode())
        if total_bytes > MAX_TOTAL_BYTES:
            raise ValueError('GIS collection exceeds the total size limit')
        features.extend(batch)
        if not more and len(batch) < PAGE_SIZE:
            return features
        if not batch:
            raise ValueError('GIS pagination did not advance')
    raise ValueError('GIS pagination exceeds the record limit')


def spatial_params(region):
    return {'geometry': f'{region.bbox_min_lon},{region.bbox_min_lat},{region.bbox_max_lon},{region.bbox_max_lat}',
            'geometryType': 'esriGeometryEnvelope', 'inSR': 4326, 'outSR': 4326,
            'spatialRel': 'esriSpatialRelIntersects', 'f': 'geojson', 'where': '1=1'}
