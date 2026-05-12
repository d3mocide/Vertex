import httpx
import asyncio

async def test_smoke():
    url = "https://maps.ncei.noaa.gov/arcgis/rest/services/nowCoast_Visible_Imagery/MapServer/WmsServer"
    params = {
        "service": "WMS",
        "request": "GetCapabilities"
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            resp = await client.get(url, params=params, headers=headers)
            print(f"Status: {resp.status_code}")
            if resp.status_code == 200:
                print(f"Content preview: {resp.text[:500]}")
            else:
                print(f"Error content: {resp.text[:200]}")
        except Exception as e:
            print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(test_smoke())
