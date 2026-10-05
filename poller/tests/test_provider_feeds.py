"""Multi-provider snapshots preserve both states and remove only unselected slices."""
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import provider_feeds as feeds


class Redis:
    def __init__(self):
        self.values = {}
        self.hashes = {}
        self.messages = []

    async def set(self, key, value, **kwargs):
        self.values[key] = value

    async def get(self, key):
        return self.values.get(key)

    async def mget(self, keys):
        return [self.values.get(key) for key in keys]

    async def exists(self, key):
        return key in self.values

    async def delete(self, key):
        self.values.pop(key, None)

    async def hset(self, key, field, value):
        self.hashes.setdefault(key, {})[field] = value

    async def hget(self, key, field):
        return self.hashes.get(key, {}).get(field)

    async def hdel(self, key, field):
        self.hashes.get(key, {}).pop(field, None)

    async def publish(self, channel, payload):
        self.messages.append(json.loads(payload))


def plan(*pids):
    return {pid: {"reason": None, "contracts": ["traffic.incidents", "traffic.cameras"]} for pid in pids}


@pytest.fixture(autouse=True)
def reset_state():
    feeds.owners.clear()
    feeds._locks.clear()
    yield
    feeds.owners.clear()
    feeds._locks.clear()


@pytest.mark.asyncio
async def test_concurrent_providers_do_not_overwrite_each_other():
    redis = Redis()
    feeds.configure(plan("odot-tripcheck", "wsdot-travel"))
    output = []
    async def combined(key, value):
        output[:] = value
    ts = datetime.now(timezone.utc).isoformat()
    await asyncio.gather(
        feeds.publish(redis, "traffic:incidents", [{"title": "Oregon", "dist_km": 2, "group": "c0"}], "odot-tripcheck", ts, combined),
        feeds.publish(redis, "traffic:incidents", [{"title": "Washington", "dist_km": 1, "group": "c0"}], "wsdot-travel", ts, combined),
    )
    assert [row["title"] for row in output] == ["Washington", "Oregon"]
    assert {row["group"] for row in output} == {"odot-tripcheck:c0", "wsdot-travel:c0"}
    assert all(row["fetched_at"] == ts and row["attribution"] in {"ODOT", "WSDOT"} for row in output)
    await feeds.publish(redis, "traffic:incidents", [], "wsdot-travel", ts, combined)
    assert [row["title"] for row in output] == ["Oregon"]


def test_shared_bridge_cameras_deduplicate_without_breaking_odot_bookmarks():
    a = feeds.provenance([{"id": "123", "url": "https://www.tripcheck.com/RoadCams/Bridge%20NB.jpg", "dist_km": 2}], "odot-tripcheck", "fixture")
    b = feeds.provenance([{"id": "123", "url": "https://www.tripcheck.com/RoadCams/bridge%20nb.jpg", "dist_km": 2}], "wsdot-travel", "fixture")
    merged = feeds.merge("traffic:cameras", [a, b])
    assert len(merged) == 1 and merged[0]["id"] == "123"
    assert merged[0]["provider_ids"] == ["odot-tripcheck", "wsdot-travel"]
    assert a[0].get("provider_ids") is None


def test_new_provider_ids_cannot_collide_with_existing_odot_camera_ids():
    a = feeds.provenance([{"id": "1", "url": "https://example.invalid/one"}], "odot-tripcheck", "fixture")
    b = feeds.provenance([{"id": "1", "url": "https://example.invalid/two"}], "wsdot-travel", "fixture")
    assert {row["id"] for row in feeds.merge("traffic:cameras", [a, b])} == {"1", "wsdot-travel:1"}


@pytest.mark.asyncio
async def test_switch_removes_only_disabled_provider_and_preserves_true_age():
    redis = Redis()
    old = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    new = datetime.now(timezone.utc).isoformat()
    for pid, ts in (("odot-tripcheck", old), ("wsdot-travel", new)):
        await redis.set(feeds.slice_key(pid, "traffic:incidents"), json.dumps([{"title": pid, "provider_id": pid}]))
        await redis.hset("feed:meta", feeds.meta_key(pid, "traffic:incidents"), ts)
    await redis.hset("feed:meta", "traffic:incidents", new)
    feeds.configure(plan("odot-tripcheck"))
    output = {}
    async def combined(key, value, refresh_age):
        assert refresh_age is False
        output[key] = value
    await feeds.reconcile(redis, combined)
    assert output["traffic:incidents"][0]["provider_id"] == "odot-tripcheck"
    assert await redis.get(feeds.slice_key("wsdot-travel", "traffic:incidents")) is None
    assert await redis.hget("feed:meta", "traffic:incidents") == old
    assert await redis.hget("feed:meta", feeds.meta_key("wsdot-travel", "traffic:incidents")) is None


@pytest.mark.asyncio
async def test_core_only_clears_stale_combined_keys_and_notifies_clients():
    redis = Redis()
    await redis.set("feed:traffic:incidents", json.dumps([{"title": "old"}]))
    await redis.hset("feed:meta", "traffic:incidents", "old")
    feeds.configure({})
    async def combined(*args, **kwargs):
        pytest.fail("No selected provider should be republished")
    await feeds.reconcile(redis, combined)
    assert await redis.get("feed:traffic:incidents") is None
    assert await redis.hget("feed:meta", "traffic:incidents") is None
    assert any(message["key"] == "traffic:incidents" and message["data"] == [] for message in redis.messages)


@pytest.mark.asyncio
async def test_enabling_second_pack_adopts_fresh_legacy_odot_snapshot():
    redis = Redis()
    ts = datetime.now(timezone.utc).isoformat()
    await redis.set("feed:traffic:cameras", json.dumps([{"id": "123", "url": "https://example.invalid/camera"}]))
    await redis.hset("feed:meta", "traffic:cameras", ts)
    feeds.configure(plan("wsdot-travel", "odot-tripcheck"))
    output = {}
    async def combined(key, value, refresh_age):
        output[key] = value
    await feeds.reconcile(redis, combined)
    assert output["traffic:cameras"][0]["id"] == "123"
    assert output["traffic:cameras"][0]["provider_id"] == "odot-tripcheck"


@pytest.mark.asyncio
async def test_unselected_provider_cannot_repopulate_a_disabled_contract():
    redis = Redis()
    feeds.configure({})
    async def combined(*args):
        pytest.fail("Unselected provider was published")
    await feeds.publish(redis, "traffic:incidents", [{"title": "ignored"}], "odot-tripcheck", "fixture", combined)
    assert redis.values == {}


def test_non_list_contracts_cannot_be_overwritten_by_multiple_providers():
    with pytest.raises(ValueError):
        feeds.merge("utility:outages", [{"areas": []}, {"areas": []}])


def test_outage_contract_merges_attributed_utilities_and_preserves_coverage():
    def snapshot(pid,label,total):
        return feeds.provenance({'type':'FeatureCollection','features':[], 'near':[{'utility':'Example Electric','meters_out':total,'dist_km':2}], 'utilities':[{'id':'example-electric','name':'Example Electric','state':label,'coverage':label,'meters_out':total,'nearby_meters_out':total}], 'coverage':[label],'near_radius_km':30,'updated':'2026-09-30T00:00:00+00:00'},pid,'2026-09-30T00:00:00+00:00')
    a,b=snapshot('oregon-odin','Oregon',5),snapshot('example-washington','Washington',7)
    merged=feeds.merge('utility:outages',[a,b])
    assert merged['coverage']==['Oregon','Washington'] and len(merged['near'])==2
    assert len({row['id'] for row in merged['utilities']})==2
    assert sum(row['meters_out'] for row in merged['utilities'])==12
    assert a['near'][0]['provider_id']=='oregon-odin' and a['utilities'][0]['attribution']=='Oregon ODIN'
    assert feeds.merge('utility:outages',[a])['utilities'][0]['meters_out']==5


def test_camera_image_urls_on_https_hosts_are_upgraded_and_other_urls_left_alone():
    rows = feeds.provenance([
        {"id": "1", "url": "http://www.tripcheck.com/roadcams/cams/a.jpg", "ldi_url": "http://www.tripcheck.com/roadcams/cams/a.jpg"},
        {"id": "2", "url": "http://images.wsdot.com/b.jpg"},
        {"id": "3", "url": "http://example.org/c.jpg"},
        {"id": "4", "url": "https://www.tripcheck.com/d.jpg"},
        {"id": "5"},
    ], "odot-tripcheck", "2026-10-05T00:00:00Z")
    assert rows[0]["url"] == rows[0]["ldi_url"] == "https://www.tripcheck.com/roadcams/cams/a.jpg"
    assert rows[1]["url"] == "https://images.wsdot.com/b.jpg"
    assert rows[2]["url"] == "http://example.org/c.jpg" and rows[3]["url"].startswith("https://")
    assert "url" not in rows[4]
