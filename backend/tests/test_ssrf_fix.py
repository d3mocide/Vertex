from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import MagicMock

_BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

# ---------------------------------------------------------------------------
# Stub heavy dependencies before importing router.
# ---------------------------------------------------------------------------
for _mod in [
    "db.session",
    "redis_bus",
    "auth_middleware",
    "rate_limit",
    "metrics_collector",
    "webhook_dispatcher",
    "prometheus_fastapi_instrumentator",
    "deps",
]:
    sys.modules.setdefault(_mod, MagicMock())

_mock_settings = MagicMock()
_mock_settings.auth_enabled = False
_mock_settings.auth_secret_key = "test-secret-key-at-least-32-chars!!"
_mock_config = MagicMock()
_mock_config.settings = _mock_settings
sys.modules["config"] = _mock_config

from security import validate_safe_url, validate_safe_host  # noqa: E402
from routers.admin_debug import _http_get_check, _http_post_check, _probe_ws, _probe_aprs_tcp  # noqa: E402

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
                        validate_safe_url(url, allowed_schemes={"ws", "wss"})
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
        # These should NOT raise ValueError (assuming they resolve to public IPs).
        # Domain-name entries are skipped if DNS is unavailable in the test environment.
        for url in public_urls:
            with self.subTest(url=url):
                try:
                    if url.startswith("ws"):
                        validate_safe_url(url, allowed_schemes={"ws", "wss"})
                    else:
                        validate_safe_url(url)
                except ValueError as e:
                    if "Cannot resolve hostname" in str(e):
                        # DNS unavailable in this environment — not an SSRF issue.
                        continue
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
