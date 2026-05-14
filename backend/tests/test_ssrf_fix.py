import unittest
import asyncio
from backend.security import validate_safe_url, validate_safe_host
from backend.routers.admin_debug import _http_get_check, _http_post_check, _probe_ws, _probe_aprs_tcp

class TestSSRFValidation(unittest.TestCase):
    def test_validate_safe_url_internal(self):
        internal_urls = [
            "http://127.0.0.1",
            "https://localhost",
            "http://169.254.169.254",
            "http://192.168.1.1",
            "http://10.0.0.1",
            "ws://127.0.0.1",
            "wss://localhost",
        ]
        for url in internal_urls:
            with self.subTest(url=url):
                with self.assertRaises(ValueError) as cm:
                    if url.startswith("ws"):
                        validate_safe_url(url, allowed_schemes=("ws", "wss"))
                    else:
                        validate_safe_url(url)
                self.assertIn("non-public address", str(cm.exception))

    def test_validate_safe_host_internal(self):
        internal_hosts = [
            "127.0.0.1",
            "localhost",
            "169.254.169.254",
            "192.168.1.1",
            "10.0.0.1",
        ]
        for host in internal_hosts:
            with self.subTest(host=host):
                with self.assertRaises(ValueError) as cm:
                    validate_safe_host(host)
                self.assertIn("non-public address", str(cm.exception))

    def test_validate_safe_url_public(self):
        public_urls = [
            "http://8.8.8.8",
            "https://google.com",
            "ws://echo.websocket.org",
        ]
        # These should NOT raise ValueError (assuming they resolve to public IPs)
        for url in public_urls:
            with self.subTest(url=url):
                try:
                    if url.startswith("ws"):
                        validate_safe_url(url, allowed_schemes=("ws", "wss"))
                    else:
                        validate_safe_url(url)
                except ValueError as e:
                    self.fail(f"validate_safe_url raised ValueError for public URL {url}: {e}")

class TestAsyncProbeSSRF(unittest.IsolatedAsyncioTestCase):
    async def test_http_get_check_ssrf(self):
        res, payload = await _http_get_check("http://127.0.0.1")
        self.assertFalse(res["ok"])
        self.assertIn("non-public address", res["error"])

    async def test_http_post_check_ssrf(self):
        res, payload = await _http_post_check("http://127.0.0.1", {})
        self.assertFalse(res["ok"])
        self.assertIn("non-public address", res["error"])

    async def test_probe_ws_ssrf(self):
        res = await _probe_ws("ws://127.0.0.1", 1)
        self.assertFalse(res["connected"])
        self.assertIn("non-public address", res["error"])

    async def test_probe_aprs_tcp_ssrf(self):
        res = await _probe_aprs_tcp("127.0.0.1:14580")
        self.assertFalse(res["ok"])
        self.assertIn("non-public address", res["error"])

if __name__ == "__main__":
    unittest.main()
