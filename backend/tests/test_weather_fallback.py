"""Current conditions fall back to the Weather Radio reading only when the NWS feed has gone quiet."""
import asyncio
import json
from datetime import datetime, timedelta, timezone

from routers import weather

NOW = datetime(2026, 10, 14, 23, 30, tzinfo=timezone.utc)
NWS = {"station": "https://api.weather.gov/stations/KHIO", "temp_f": 60.8, "wind_mph": 4.6, "condition": "Clear"}
HOME = {"station": "NOAA Weather Radio (Portland)", "temp_f": 71.0, "wind_mph": 7, "condition": "Sunny", "source": "nwr",
        "timestamp": "2026-10-14T23:00:00+00:00"}


class FakeRedis:
    def __init__(self, current=None, meta_age_s=None, broadcast=None):
        self.kv = {}
        if current is not None:
            self.kv["feed:weather:current"] = json.dumps(current)
        if broadcast is not None:
            self.kv["feed:nwr:broadcast"] = json.dumps(broadcast)
        self.meta = None if meta_age_s is None else (NOW - timedelta(seconds=meta_age_s)).isoformat()

    async def get(self, key):
        return self.kv.get(key)

    async def hget(self, key, field):
        assert (key, field) == ("feed:meta", "weather:current")
        return self.meta


def run(r):
    return asyncio.run(weather.current_conditions(r, NOW))


def test_a_fresh_nws_observation_is_served_as_is_even_when_the_radio_has_one():
    assert run(FakeRedis(NWS, meta_age_s=120, broadcast={"home": HOME})) == NWS


def test_a_stale_nws_feed_is_replaced_by_the_radio_reading_and_marked_as_a_fallback():
    out = run(FakeRedis(NWS, meta_age_s=40 * 60, broadcast={"home": HOME}))
    assert out["source"] == "nwr" and out["temp_f"] == 71.0 and out["stale_feed"] is True


def test_a_missing_nws_feed_uses_the_radio_reading():
    assert run(FakeRedis(None, broadcast={"home": HOME}))["source"] == "nwr"


def test_with_no_radio_reading_the_old_nws_value_is_still_better_than_nothing():
    assert run(FakeRedis(NWS, meta_age_s=3600)) == NWS
    assert run(FakeRedis(NWS, meta_age_s=3600, broadcast={"home": None})) == NWS
    assert run(FakeRedis(None)) == {}


def test_a_feed_with_no_recorded_age_but_a_value_is_trusted():
    assert run(FakeRedis(NWS, meta_age_s=None)) == NWS


def test_a_radio_reading_with_no_temperature_is_not_offered():
    assert run(FakeRedis(None, broadcast={"home": {**HOME, "temp_f": None}})) == {}
