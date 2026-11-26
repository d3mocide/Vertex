"""Camera health probes: shared client, bounded concurrency, results reused for a while."""
import asyncio
import unittest

import httpx

from pollers import traffic


def _cams(n, host="tripcheck.example.org"):
    return [{"id": i, "url": f"https://{host}/cam{i}.jpg"} for i in range(n)]


class CameraHealthTests(unittest.TestCase):
    def setUp(self):
        traffic._camera_health_cache.clear()
        self.requests = 0
        self.in_flight = 0
        self.max_in_flight = 0

    def _client(self, status_for=lambda url: 200):
        async def handler(request: httpx.Request) -> httpx.Response:
            self.requests += 1
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
            await asyncio.sleep(0.001)
            self.in_flight -= 1
            status = status_for(str(request.url))
            if status is None:
                raise httpx.ConnectError("boom", request=request)
            return httpx.Response(status)
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    def _run(self, cams, client, now):
        async def go():
            async with client:
                await traffic._check_camera_health(cams, client=client, now=now)
        asyncio.run(go())

    def test_statuses_and_bounded_concurrency(self):
        cams = _cams(40)
        cams.append({"id": "lan", "url": "http://10.0.0.5/cam.jpg"})
        cams.append({"id": "none", "url": ""})

        def status_for(url):
            if url.endswith("cam1.jpg"):
                return 404
            if url.endswith("cam2.jpg"):
                return None
            return 200
        self._run(cams, self._client(status_for), now=1000.0)
        by_id = {c["id"]: c for c in cams}
        self.assertEqual((by_id[0]["health"], by_id[0]["last_ok_ts"]), ("ok", 1000))
        self.assertEqual((by_id[1]["health"], by_id[1]["last_ok_ts"]), ("warn", None))
        self.assertEqual((by_id[2]["health"], by_id[2]["last_ok_ts"]), ("down", None))
        self.assertEqual(by_id["lan"]["health"], "unknown")
        self.assertEqual(by_id["none"]["health"], "unknown")
        self.assertEqual(self.requests, 40)                       # private and empty URLs are never requested
        self.assertLessEqual(self.max_in_flight, traffic._CAMERA_PROBE_CONCURRENCY)

    def test_results_are_reused_within_the_ttl_then_refreshed(self):
        self._run(_cams(10), self._client(), now=1000.0)
        self.assertEqual(self.requests, 10)

        again = _cams(10)
        self._run(again, self._client(), now=1000.0 + traffic._CAMERA_HEALTH_TTL - 1)
        self.assertEqual(self.requests, 10)                       # nothing new
        self.assertTrue(all(c["health"] == "ok" and c["last_ok_ts"] == 1000 for c in again))

        later = _cams(10)
        self._run(later, self._client(), now=1000.0 + traffic._CAMERA_HEALTH_TTL + 1)
        self.assertEqual(self.requests, 20)                       # expired: probed again
        self.assertTrue(all(c["last_ok_ts"] == int(1000.0 + traffic._CAMERA_HEALTH_TTL + 1) for c in later))

    def test_new_cameras_are_probed_and_old_entries_are_forgotten(self):
        self._run(_cams(5), self._client(), now=1000.0)
        self._run(_cams(5, host="other.example.org"), self._client(), now=1000.0 + 3 * traffic._CAMERA_HEALTH_TTL)
        self.assertEqual(self.requests, 10)
        self.assertTrue(all("other.example.org" in url for url in traffic._camera_health_cache))


if __name__ == "__main__":
    unittest.main()
