import httpx

try:
    r = httpx.get('http://localhost:8000/api/v1/weather/smoke/wms', 
        params={
            'service': 'WMS',
            'request': 'GetMap',
            'version': '1.1.1',
            'layers': '0',
            'styles': '',
            'format': 'image/png',
            'transparent': 'true',
            'srs': 'EPSG:3857',
            'width': '256',
            'height': '256',
            'bbox': '-13618288,5635549,-13520495,5733322'
        }, 
        timeout=20
    )
    print(f'Status: {r.status_code}')
    print(f'Content-Type: {r.headers.get("content-type")}')
    print(f'Size: {len(r.content)} bytes')
    print(f'PNG header ok: {r.content[:8] == b"\x89PNG\r\n\x1a\n"}')
    if len(r.content) > 100:
        print(f'Real tile data received (size > 100 bytes)')
    else:
        print(f'Fallback transparent PNG returned')
except Exception as e:
    print(f'Error: {e}')
