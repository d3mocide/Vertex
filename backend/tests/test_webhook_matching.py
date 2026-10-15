"""Which events an alert rule fires on. Loads the real backend/webhook_dispatcher.py under its own name, with its
database, Redis and network dependencies stubbed, because other test files stub the module itself."""
import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import pytest


@pytest.fixture(scope="module")
def dispatcher():
    stubs = {
        "db.models": SimpleNamespace(AlertRule=object),
        "db.session": SimpleNamespace(async_session_factory=MagicMock()),
        "redis_bus": SimpleNamespace(subscribe_updates=MagicMock(), get_redis=MagicMock()),
        "security": SimpleNamespace(send_pinned_http_request=MagicMock(), validate_webhook_url_async=MagicMock()),
    }
    saved = {k: sys.modules.get(k) for k in stubs}
    for name, stub in stubs.items():
        mod = ModuleType(name)
        mod.__dict__.update(vars(stub))
        sys.modules[name] = mod
    try:
        spec = importlib.util.spec_from_file_location("webhook_dispatcher_real", Path(__file__).parent.parent / "webhook_dispatcher.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, old in saved.items():
            if old is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old


def rule(trigger, enabled=True, **flt):
    return SimpleNamespace(enabled=enabled, trigger_type=trigger, rule_filter=flt)


def event(severity="critical", event_type="nwr_alert", details=None):
    return {"event_type": event_type, "severity": severity, "details": details if details is not None else {"event": "Tornado Warning"}}


# ── weather_alert ────────────────────────────────────────────────────────────────────────────────

def test_weather_alert_fires_on_radio_alerts_at_or_above_medium_by_default(dispatcher):
    r = rule("weather_alert")
    assert dispatcher._matches_rule(r, event("critical")) and dispatcher._matches_rule(r, event("medium"))
    assert not dispatcher._matches_rule(r, event("low"))


def test_weather_alert_min_severity_can_be_raised(dispatcher):
    assert not dispatcher._matches_rule(rule("weather_alert", min_severity="critical"), event("medium"))
    assert dispatcher._matches_rule(rule("weather_alert", min_severity="critical"), event("critical"))


def test_weather_alert_ignores_other_events_and_the_confirmation_follow_up(dispatcher):
    r = rule("weather_alert")
    assert not dispatcher._matches_rule(r, event(event_type="geofence_entry"))
    assert not dispatcher._matches_rule(r, event(event_type="nwr_alert_confirmed"))      # not a second alert


def test_weather_alert_can_name_an_event_case_insensitively(dispatcher):
    r = rule("weather_alert", event="FLOOD")
    assert dispatcher._matches_rule(r, event(details={"event": "Flash Flood Warning"}))
    assert not dispatcher._matches_rule(r, event())
    assert not dispatcher._matches_rule(r, event(details={}))


def test_a_disabled_rule_never_fires(dispatcher):
    assert not dispatcher._matches_rule(rule("weather_alert", enabled=False), event())


# ── the pre-existing triggers keep their behaviour ─────────────────────────────────────────────────

def test_severity_threshold_still_matches_any_event_type_at_the_threshold(dispatcher):
    r = rule("severity_threshold", min_severity="high")
    assert dispatcher._matches_rule(r, event("critical", "anything")) and not dispatcher._matches_rule(r, event("medium", "anything"))


def test_geofence_entry_and_entity_type_and_scheduled(dispatcher):
    assert dispatcher._matches_rule(rule("geofence_entry"), event(event_type="geofence_entry", details={}))
    assert not dispatcher._matches_rule(rule("geofence_entry", zone_type="alert"), event(event_type="geofence_entry", details={"zone_type": "info"}))
    assert dispatcher._matches_rule(rule("entity_type", entity_type="Aircraft"), event(details={"entity_type": "aircraft"}))
    assert not dispatcher._matches_rule(rule("entity_type"), event(details={"entity_type": "aircraft"}))   # no filter, no match
    assert not dispatcher._matches_rule(rule("scheduled"), event())
