import httpx
import asyncio

async def test_goes():
    url = "https://nowcoast.noaa.gov/geoserver/satellite/wms"
    params = {
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": "1.3.0",
        "LAYERS": "goes_longwave_imagery",
        "STYLES": "",
        "FORMAT": "image/png",
        "TRANSPARENT": "true",
        "CRS": "EPSG:3857",
        "WIDTH": "256",
        "HEIGHT": "256",
        "BBOX": "-13697515.468703585,5635549.221409474,-13619243.951739565,5713820.738373496"
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            resp = await client.get(url, params=params, headers=headers)
            print(f"Status: {resp.status_code}")
            if resp.status_code == 200:
                print(f"Content length: {len(resp.content)}")
                print(f"Content type: {resp.headers.get('content-type')}")
            else:
                print(f"Error content: {resp.text[:200]}")
        except Exception as e:
            print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(test_goes())
