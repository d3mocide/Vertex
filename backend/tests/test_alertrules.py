"""Tests for the alert rules router (backend/routers/alertrules.py).

No live database required — DB session is fully mocked.

Run from backend/:
    pytest tests/test_alertrules.py -v
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
# Stub db.session with a real SQLAlchemy Base so db.models ORM classes work.
# ---------------------------------------------------------------------------
from sqlalchemy.orm import DeclarativeBase as _DeclarativeBase  # noqa: E402


class _Base(_DeclarativeBase):
    pass


_mock_db_session = MagicMock()
_mock_db_session.Base = _Base
_mock_db_session.async_session_factory = MagicMock()
sys.modules["db.session"] = _mock_db_session

# ---------------------------------------------------------------------------
# Stub remaining heavy deps before importing router
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

# Stub config
_mock_settings = MagicMock()
_mock_settings.auth_enabled = False
_mock_settings.auth_secret_key = "test-secret-key-at-least-32-chars!"
_mock_settings.log_level = "DEBUG"
_mock_config = MagicMock()
_mock_config.settings = _mock_settings
sys.modules["config"] = _mock_config

# Import deps for real to get the actual get_db function as the override key
import deps as _deps  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from routers.alertrules import (  # noqa: E402
    router as alertrules_router,
    AlertRuleCreate,
    AlertRuleUpdate,
)


def _make_app(mock_db: AsyncMock) -> tuple[FastAPI, TestClient]:
    app = FastAPI()
    app.include_router(alertrules_router)
    app.dependency_overrides[_deps.get_db] = lambda: mock_db
    return app, TestClient(app, raise_server_exceptions=False)


def _sample_rule_obj(**overrides):
    """Create a minimal AlertRule-like object using the real ORM class.

    We can't instantiate it with a DB session, so use a MagicMock that mimics
    the attributes the router reads/writes.
    """
    obj = MagicMock()
    obj.id = overrides.get("id", 1)
    obj.name = overrides.get("name", "Test Rule")
    obj.enabled = overrides.get("enabled", True)
    obj.trigger_type = overrides.get("trigger_type", "geofence_entry")
    obj.rule_filter = overrides.get("rule_filter", {"geofence_id": 1})
    obj.action_type = overrides.get("action_type", "log")
    obj.action_config = overrides.get("action_config", {})
    obj.cooldown_seconds = overrides.get("cooldown_seconds", 300)
    obj.max_per_hour = overrides.get("max_per_hour", 10)
    obj.dedup_key = overrides.get("dedup_key", "rule-1")
    obj.created_at = overrides.get("created_at", datetime.now(timezone.utc))
    obj.updated_at = overrides.get("updated_at", datetime.now(timezone.utc))
    return obj


# ---------------------------------------------------------------------------
# Pydantic model validation tests (no DB needed)
# ---------------------------------------------------------------------------

class TestAlertRuleCreateValidation(unittest.TestCase):
    def test_valid_log_action(self):
        rule = AlertRuleCreate(
            name="My Rule",
            trigger_type="geofence_entry",
            action_type="log",
        )
        self.assertEqual(rule.name, "My Rule")
        self.assertEqual(rule.action_type, "log")
        self.assertTrue(rule.enabled)

    def test_name_required(self):
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            AlertRuleCreate(trigger_type="geofence_entry")  # type: ignore[call-arg]

    def test_trigger_type_required(self):
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            AlertRuleCreate(name="Test")  # type: ignore[call-arg]

    def test_invalid_trigger_type_fails(self):
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            AlertRuleCreate(name="Test", trigger_type="bad_type")

    def test_invalid_action_type_fails(self):
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            AlertRuleCreate(name="Test", trigger_type="geofence_entry", action_type="bad_action")

    def test_cooldown_seconds_accepted(self):
        rule = AlertRuleCreate(
            name="Test",
            trigger_type="geofence_entry",
            action_type="log",
            cooldown_seconds=600,
        )
        self.assertEqual(rule.cooldown_seconds, 600)

    def test_max_per_hour_accepted(self):
        rule = AlertRuleCreate(
            name="Test",
            trigger_type="geofence_entry",
            action_type="log",
            max_per_hour=5,
        )
        self.assertEqual(rule.max_per_hour, 5)

    def test_dedup_key_accepted(self):
        rule = AlertRuleCreate(
            name="Test",
            trigger_type="entity_type",
            action_type="log",
            dedup_key="unique-rule",
        )
        self.assertEqual(rule.dedup_key, "unique-rule")

    def test_empty_name_fails(self):
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            AlertRuleCreate(name="", trigger_type="geofence_entry")

    def test_all_trigger_types_accepted(self):
        for trigger in ("geofence_entry", "severity_threshold", "entity_type", "scheduled"):
            rule = AlertRuleCreate(name="T", trigger_type=trigger, action_type="log")
            self.assertEqual(rule.trigger_type, trigger)

    def test_webhook_post_default(self):
        rule = AlertRuleCreate(
            name="Webhook Rule",
            trigger_type="geofence_entry",
            action_config={"url": "http://example.com/hook"},
        )
        self.assertEqual(rule.action_type, "webhook_post")

    def test_cooldown_and_max_per_hour_both_set(self):
        rule = AlertRuleCreate(
            name="Rate Limit Test",
            trigger_type="severity_threshold",
            action_type="log",
            cooldown_seconds=120,
            max_per_hour=20,
        )
        self.assertEqual(rule.cooldown_seconds, 120)
        self.assertEqual(rule.max_per_hour, 20)


class TestAlertRuleUpdateValidation(unittest.TestCase):
    def test_partial_update_all_optional(self):
        update = AlertRuleUpdate()
        self.assertIsNone(update.name)
        self.assertIsNone(update.enabled)

    def test_invalid_trigger_type_fails(self):
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            AlertRuleUpdate(trigger_type="invalid")

    def test_cooldown_and_max_per_hour_accepted(self):
        update = AlertRuleUpdate(cooldown_seconds=120, max_per_hour=20)
        self.assertEqual(update.cooldown_seconds, 120)
        self.assertEqual(update.max_per_hour, 20)


# ---------------------------------------------------------------------------
# Route tests
# ---------------------------------------------------------------------------

class TestListAlertRules(unittest.IsolatedAsyncioTestCase):
    async def test_returns_empty_list(self):
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get("/alertrules")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    async def test_returns_list_of_rules(self):
        rule = _sample_rule_obj()
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [rule]
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get("/alertrules")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["name"], "Test Rule")
        self.assertEqual(data[0]["trigger_type"], "geofence_entry")

    async def test_rule_cooldown_and_max_per_hour_returned(self):
        rule = _sample_rule_obj(cooldown_seconds=300, max_per_hour=10)
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [rule]
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get("/alertrules")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data[0]["cooldown_seconds"], 300)
        self.assertEqual(data[0]["max_per_hour"], 10)


class TestCreateAlertRule(unittest.IsolatedAsyncioTestCase):
    async def test_log_action_rule_created(self):
        """Log action rules don't require extra action_config fields."""
        rule = _sample_rule_obj(action_type="log", action_config={})
        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()

        # mock_db.refresh should mutate the rule object (already fully set up)
        async def _refresh(obj):
            pass

        mock_db.refresh = _refresh

        # Patch AlertRule in the router module to return our pre-configured mock
        import routers.alertrules as ar_module
        original_cls = ar_module.AlertRule

        def _fake_alert_rule(**kw):
            return rule

        ar_module.AlertRule = _fake_alert_rule
        _, client = _make_app(mock_db)

        resp = client.post(
            "/alertrules",
            json={
                "name": "Test Rule",
                "trigger_type": "geofence_entry",
                "action_type": "log",
            },
        )
        ar_module.AlertRule = original_cls
        self.assertEqual(resp.status_code, 201)

    async def test_webhook_post_missing_url_returns_400(self):
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.post(
            "/alertrules",
            json={
                "name": "Bad Webhook",
                "trigger_type": "geofence_entry",
                "action_type": "webhook_post",
                "action_config": {},
            },
        )
        self.assertEqual(resp.status_code, 400)

    async def test_sitrep_missing_interval_returns_400(self):
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.post(
            "/alertrules",
            json={
                "name": "Sitrep",
                "trigger_type": "scheduled",
                "action_type": "sitrep_delivery",
                "action_config": {},
            },
        )
        self.assertEqual(resp.status_code, 400)


class TestUpdateAlertRule(unittest.IsolatedAsyncioTestCase):
    async def test_update_returns_404_when_rule_not_found(self):
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.patch("/alertrules/999", json={"name": "Updated"})
        self.assertEqual(resp.status_code, 404)

    async def test_update_modifies_rule(self):
        rule = _sample_rule_obj(action_type="log", action_config={})
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = rule
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()

        async def _refresh(obj):
            pass

        mock_db.refresh = _refresh
        _, client = _make_app(mock_db)

        resp = client.patch("/alertrules/1", json={"name": "Updated Name", "enabled": False})
        self.assertEqual(resp.status_code, 200)
        # Rule object was mutated by setattr calls in the router
        self.assertEqual(rule.name, "Updated Name")
        self.assertFalse(rule.enabled)


class TestDeleteAlertRule(unittest.IsolatedAsyncioTestCase):
    async def test_delete_returns_404_when_not_found(self):
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.delete("/alertrules/999")
        self.assertEqual(resp.status_code, 404)

    async def test_delete_calls_db_delete(self):
        rule = _sample_rule_obj()
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = rule
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.delete = AsyncMock()
        mock_db.commit = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.delete("/alertrules/1")
        self.assertEqual(resp.status_code, 204)
        mock_db.delete.assert_called_once_with(rule)
        mock_db.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
