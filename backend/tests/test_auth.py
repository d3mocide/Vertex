"""Tests for the auth router (backend/routers/auth.py).

No live database required — DB session is fully mocked.

Run from backend/:
    pytest tests/test_auth.py -v
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

_BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

# ---------------------------------------------------------------------------
# Stub db.session with a real SQLAlchemy Base so that db.models ORM classes
# work properly (needed by auth router which imports User/UserPreference).
# ---------------------------------------------------------------------------
from sqlalchemy.orm import DeclarativeBase as _DeclarativeBase  # noqa: E402


class _Base(_DeclarativeBase):
    pass


_mock_db_session = MagicMock()
_mock_db_session.Base = _Base
_mock_db_session.async_session_factory = MagicMock()
sys.modules["db.session"] = _mock_db_session

# ---------------------------------------------------------------------------
# Stub remaining heavyweight dependencies before importing router
# ---------------------------------------------------------------------------
for _mod in [
    "redis_bus",
    "auth_middleware",
    "rate_limit",
    "metrics_collector",
    "webhook_dispatcher",
    "prometheus_fastapi_instrumentator",
]:
    sys.modules.setdefault(_mod, MagicMock())

# Stub config settings
_mock_settings = MagicMock()
_mock_settings.auth_enabled = False
_mock_settings.auth_secret_key = "test-secret-key-at-least-32-chars!!"
_mock_settings.auth_token_expire_hours = 24
_mock_settings.log_level = "DEBUG"

_mock_config = MagicMock()
_mock_config.settings = _mock_settings
sys.modules["config"] = _mock_config

# Import deps for real to get the actual get_db function (used as override key)
import deps as _deps  # noqa: E402

# Now safe to import jose directly (not mocked)
from jose import jwt  # noqa: E402

# Late import of the router and its helpers after stubs are in place
from routers.auth import (  # noqa: E402
    _make_token,
    _hash_api_key,
    SetupRequest,
    CreateUserRequest,
    router as auth_router,
)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Import db.models AFTER stubs so we get the real SQLAlchemy classes
import db.models as _models  # noqa: E402


def _make_app(mock_db: AsyncMock) -> tuple[FastAPI, TestClient]:
    """Build a minimal FastAPI app with auth router and mocked DB dependency."""
    app = FastAPI()
    app.include_router(auth_router)
    # Override using the ACTUAL get_db as the key
    app.dependency_overrides[_deps.get_db] = lambda: mock_db
    return app, TestClient(app, raise_server_exceptions=False)


def _build_token(username: str, role: str) -> str:
    return _make_token(username, role)


# ---------------------------------------------------------------------------
# Unit tests for pure helpers
# ---------------------------------------------------------------------------

class TestMakeToken(unittest.TestCase):
    def test_payload_has_sub(self):
        token = _build_token("alice", "admin")
        payload = jwt.decode(token, _mock_settings.auth_secret_key, algorithms=["HS256"])
        self.assertEqual(payload["sub"], "alice")

    def test_payload_has_role(self):
        token = _build_token("alice", "viewer")
        payload = jwt.decode(token, _mock_settings.auth_secret_key, algorithms=["HS256"])
        self.assertEqual(payload["role"], "viewer")

    def test_payload_has_exp(self):
        token = _build_token("alice", "admin")
        payload = jwt.decode(token, _mock_settings.auth_secret_key, algorithms=["HS256"])
        self.assertIn("exp", payload)

    def test_admin_and_viewer_differ(self):
        t1 = _build_token("user", "admin")
        t2 = _build_token("user", "viewer")
        self.assertNotEqual(t1, t2)


class TestHashApiKey(unittest.TestCase):
    def test_deterministic(self):
        self.assertEqual(_hash_api_key("abc"), _hash_api_key("abc"))

    def test_different_inputs_differ(self):
        self.assertNotEqual(_hash_api_key("abc"), _hash_api_key("xyz"))

    def test_returns_hex_string(self):
        h = _hash_api_key("key")
        self.assertTrue(all(c in "0123456789abcdef" for c in h))


class TestSetupRequestValidation(unittest.TestCase):
    """Pydantic validation tests for SetupRequest — no DB needed."""

    def test_valid_request_passes(self):
        req = SetupRequest(username="admin", password="validpassword1")
        self.assertEqual(req.username, "admin")

    def test_password_too_short_fails(self):
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            SetupRequest(username="admin", password="short")

    def test_eleven_char_password_fails(self):
        """Exactly 11 chars is below min_length=12."""
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            SetupRequest(username="admin", password="elevenlettr")

    def test_twelve_char_password_passes(self):
        req = SetupRequest(username="admin", password="twelveletters")
        self.assertIsNotNone(req)

    def test_username_too_short_fails(self):
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            SetupRequest(username="ab", password="validpassword1")

    def test_username_invalid_chars_fails(self):
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            SetupRequest(username="bad user!", password="validpassword1")

    def test_username_required(self):
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            SetupRequest(password="validpassword1")  # type: ignore[call-arg]


class TestCreateUserRequestValidation(unittest.TestCase):
    def test_valid_viewer(self):
        req = CreateUserRequest(username="bob", password="validpassword1", role="viewer")
        self.assertEqual(req.role, "viewer")

    def test_valid_admin(self):
        req = CreateUserRequest(username="alice", password="validpassword1", role="admin")
        self.assertEqual(req.role, "admin")

    def test_invalid_role_fails(self):
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            CreateUserRequest(username="alice", password="validpassword1", role="superuser")

    def test_default_role_is_viewer(self):
        req = CreateUserRequest(username="carol", password="validpassword1")
        self.assertEqual(req.role, "viewer")


# ---------------------------------------------------------------------------
# Route tests — use IsolatedAsyncioTestCase for async DB mocks
# ---------------------------------------------------------------------------

class TestAuthStatusEndpoint(unittest.IsolatedAsyncioTestCase):
    async def test_auth_disabled_returns_false(self):
        _mock_settings.auth_enabled = False
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.get("/auth/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertFalse(data["auth_enabled"])
        self.assertFalse(data["setup_required"])

    async def test_auth_enabled_with_users_returns_setup_not_required(self):
        _mock_settings.auth_enabled = True
        mock_db = AsyncMock()
        mock_db.scalar = AsyncMock(return_value=1)  # user count = 1
        _, client = _make_app(mock_db)

        resp = client.get("/auth/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["auth_enabled"])
        self.assertFalse(data["setup_required"])
        _mock_settings.auth_enabled = False

    async def test_auth_enabled_no_users_returns_setup_required(self):
        _mock_settings.auth_enabled = True
        mock_db = AsyncMock()
        mock_db.scalar = AsyncMock(return_value=0)  # user count = 0
        _, client = _make_app(mock_db)

        resp = client.get("/auth/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["auth_enabled"])
        self.assertTrue(data["setup_required"])
        _mock_settings.auth_enabled = False


class TestSetupEndpoint(unittest.IsolatedAsyncioTestCase):
    async def test_setup_disabled_returns_404(self):
        _mock_settings.auth_enabled = False
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)
        resp = client.post("/auth/setup", json={"username": "admin", "password": "validpassword1"})
        self.assertEqual(resp.status_code, 404)

    async def test_setup_creates_first_admin(self):
        _mock_settings.auth_enabled = True
        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.post("/auth/setup", json={"username": "admin", "password": "validpassword1"})
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertIn("access_token", data)
        self.assertEqual(data["token_type"], "bearer")
        _mock_settings.auth_enabled = False

    async def test_setup_conflict_returns_409(self):
        _mock_settings.auth_enabled = True
        from sqlalchemy.exc import IntegrityError
        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock(side_effect=IntegrityError(None, None, None))
        mock_db.rollback = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.post("/auth/setup", json={"username": "admin", "password": "validpassword1"})
        self.assertEqual(resp.status_code, 409)
        _mock_settings.auth_enabled = False


class TestLoginEndpoint(unittest.IsolatedAsyncioTestCase):
    async def test_login_disabled_returns_404(self):
        _mock_settings.auth_enabled = False
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)
        resp = client.post("/auth/token", data={"username": "admin", "password": "pass"})
        self.assertEqual(resp.status_code, 404)

    async def test_valid_credentials_return_token(self):
        _mock_settings.auth_enabled = True
        from passlib.context import CryptContext
        _pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
        hashed = _pwd.hash("validpassword1")

        # Use a real _models.User-like object with required attributes
        mock_user = MagicMock()
        mock_user.username = "admin"
        mock_user.password_hash = hashed
        mock_user.role = "admin"
        mock_user.last_login = None

        mock_db = AsyncMock()
        mock_db.scalar = AsyncMock(return_value=mock_user)
        mock_db.commit = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.post("/auth/token", data={"username": "admin", "password": "validpassword1"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("access_token", data)
        _mock_settings.auth_enabled = False

    async def test_wrong_password_returns_401(self):
        _mock_settings.auth_enabled = True
        from passlib.context import CryptContext
        _pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
        hashed = _pwd.hash("correctpassword1")

        mock_user = MagicMock()
        mock_user.username = "admin"
        mock_user.password_hash = hashed
        mock_user.role = "admin"

        mock_db = AsyncMock()
        mock_db.scalar = AsyncMock(return_value=mock_user)
        _, client = _make_app(mock_db)

        resp = client.post("/auth/token", data={"username": "admin", "password": "wrongpassword1"})
        self.assertEqual(resp.status_code, 401)
        _mock_settings.auth_enabled = False

    async def test_unknown_user_returns_401(self):
        _mock_settings.auth_enabled = True
        mock_db = AsyncMock()
        mock_db.scalar = AsyncMock(return_value=None)
        _, client = _make_app(mock_db)

        resp = client.post("/auth/token", data={"username": "nobody", "password": "validpassword1"})
        self.assertEqual(resp.status_code, 401)
        _mock_settings.auth_enabled = False


class TestMeEndpoint(unittest.IsolatedAsyncioTestCase):
    async def test_auth_disabled_returns_local_admin(self):
        _mock_settings.auth_enabled = False
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.get("/auth/me")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["username"], "local")
        self.assertEqual(data["role"], "admin")

    async def test_valid_token_returns_user_info(self):
        _mock_settings.auth_enabled = True
        token = _build_token("alice", "viewer")
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["username"], "alice")
        self.assertEqual(data["role"], "viewer")
        _mock_settings.auth_enabled = False

    async def test_no_token_returns_401(self):
        _mock_settings.auth_enabled = True
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.get("/auth/me")
        self.assertEqual(resp.status_code, 401)
        _mock_settings.auth_enabled = False

    async def test_invalid_token_returns_401(self):
        _mock_settings.auth_enabled = True
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.get("/auth/me", headers={"Authorization": "Bearer notavalidtoken"})
        self.assertEqual(resp.status_code, 401)
        _mock_settings.auth_enabled = False


class TestCreateUserEndpoint(unittest.IsolatedAsyncioTestCase):
    async def test_auth_disabled_returns_404(self):
        _mock_settings.auth_enabled = False
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.post("/auth/users", json={"username": "bob", "password": "validpassword1"})
        self.assertEqual(resp.status_code, 404)

    async def test_admin_can_create_viewer(self):
        _mock_settings.auth_enabled = True
        token = _build_token("admin", "admin")
        mock_db = AsyncMock()
        mock_db.scalar = AsyncMock(return_value=None)  # no existing user
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.post(
            "/auth/users",
            json={"username": "bob", "password": "validpassword1", "role": "viewer"},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data["username"], "bob")
        self.assertEqual(data["role"], "viewer")
        _mock_settings.auth_enabled = False

    async def test_non_admin_returns_403(self):
        _mock_settings.auth_enabled = True
        token = _build_token("viewer_user", "viewer")
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.post(
            "/auth/users",
            json={"username": "bob", "password": "validpassword1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(resp.status_code, 403)
        _mock_settings.auth_enabled = False

    async def test_no_token_returns_401(self):
        _mock_settings.auth_enabled = True
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.post(
            "/auth/users",
            json={"username": "bob", "password": "validpassword1"},
        )
        self.assertEqual(resp.status_code, 401)
        _mock_settings.auth_enabled = False


class TestApiKeyEndpoints(unittest.IsolatedAsyncioTestCase):
    async def test_generate_api_key_auth_disabled_returns_404(self):
        _mock_settings.auth_enabled = False
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.post("/auth/apikey")
        self.assertEqual(resp.status_code, 404)

    async def test_generate_api_key_returns_raw_key(self):
        _mock_settings.auth_enabled = True
        token = _build_token("admin", "admin")

        mock_user = MagicMock()
        mock_user.username = "admin"
        mock_user.api_key_hash = None

        mock_db = AsyncMock()
        mock_db.scalar = AsyncMock(return_value=mock_user)
        mock_db.commit = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.post("/auth/apikey", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("api_key", data)
        self.assertTrue(len(data["api_key"]) > 0)
        _mock_settings.auth_enabled = False

    async def test_revoke_api_key_clears_it(self):
        _mock_settings.auth_enabled = True
        token = _build_token("admin", "admin")

        mock_user = MagicMock()
        mock_user.username = "admin"
        mock_user.api_key_hash = "somehash"

        mock_db = AsyncMock()
        mock_db.scalar = AsyncMock(return_value=mock_user)
        mock_db.commit = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.delete("/auth/apikey", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(resp.status_code, 204)
        self.assertIsNone(mock_user.api_key_hash)
        _mock_settings.auth_enabled = False

    async def test_revoke_api_key_no_token_returns_401(self):
        _mock_settings.auth_enabled = True
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.delete("/auth/apikey")
        self.assertEqual(resp.status_code, 401)
        _mock_settings.auth_enabled = False


if __name__ == "__main__":
    unittest.main()
