"""Pure-logic unit tests for WebSocket subscription filtering.

These tests do NOT require a live WebSocket, Redis, or database.

The ws.py router currently forwards all Redis messages without client-side
filtering. The filtering logic is implemented here as a standalone function
that mirrors what a future per-subscription filter would look like, and the
tests validate the logic itself.

Run from backend/:
    pytest tests/test_websocket_unit.py -v
"""
from __future__ import annotations

import os
import sys
import json
import unittest

_BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

# ---------------------------------------------------------------------------
# The ws.py router does not currently expose a per-message filter helper.
# We define the canonical filter logic here and test it thoroughly.
# If ws.py is later refactored to expose _filter_entity_update, import it:
#
#   from routers.ws import _filter_entity_update
#
# and replace references to apply_subscription_filter below.
# ---------------------------------------------------------------------------


def apply_subscription_filter(
    message_data: dict,
    sub_bbox: tuple[float, float, float, float] | None,
    sub_entity_types: list[str] | None,
) -> bool:
    """Return True if the message should be forwarded to a subscriber.

    Rules:
    - Non-entity_update messages always pass.
    - entity_update messages must satisfy ALL active filters.
    - If sub_bbox is set: entity lat/lon must fall inside the box.
      Entities with no lat/lon pass the bbox filter (can't exclude what we can't place).
    - If sub_entity_types is set: entity_type must be in the list.
    - If a filter is None/empty it is not applied (all pass that dimension).

    Args:
        message_data: Parsed JSON dict of the WebSocket message.
        sub_bbox: Optional (min_lon, min_lat, max_lon, max_lat) bounding box.
        sub_entity_types: Optional list of entity type strings to allow.

    Returns:
        True if the message passes all active filters, False otherwise.
    """
    msg_type = message_data.get("type")

    # Non-entity_update messages always pass
    if msg_type != "entity_update":
        return True

    data = message_data.get("data", {})

    # --- Entity type filter ---
    if sub_entity_types:
        entity_type = data.get("entity_type")
        if entity_type not in sub_entity_types:
            return False

    # --- Bounding box filter ---
    if sub_bbox:
        min_lon, min_lat, max_lon, max_lat = sub_bbox
        lat = data.get("lat")
        lon = data.get("lon")
        # Entities with no position pass the bbox filter
        if lat is not None and lon is not None:
            if not (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon):
                return False

    return True


# ---------------------------------------------------------------------------
# Helper to build test message dicts
# ---------------------------------------------------------------------------

def _entity_msg(entity_type: str = "aircraft", lat: float | None = 45.5,
                lon: float | None = -122.3) -> dict:
    return {
        "type": "entity_update",
        "data": {
            "entity_id": "TEST1",
            "entity_type": entity_type,
            "lat": lat,
            "lon": lon,
        },
    }


def _other_msg(msg_type: str = "snapshot") -> dict:
    return {"type": msg_type, "data": {}}


_BBOX_INSIDE = (-123.0, 45.0, -122.0, 46.0)    # aircraft at 45.5,-122.3 is inside
_BBOX_OUTSIDE = (-100.0, 30.0, -90.0, 35.0)    # aircraft is far outside


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestNonEntityUpdatePassesAlways(unittest.TestCase):
    def test_snapshot_passes_no_filters(self):
        self.assertTrue(apply_subscription_filter(_other_msg("snapshot"), None, None))

    def test_snapshot_passes_with_bbox(self):
        self.assertTrue(apply_subscription_filter(_other_msg("snapshot"), _BBOX_OUTSIDE, None))

    def test_snapshot_passes_with_type_filter(self):
        self.assertTrue(apply_subscription_filter(_other_msg("snapshot"), None, ["aircraft"]))

    def test_aircraft_snapshot_passes(self):
        self.assertTrue(apply_subscription_filter(_other_msg("aircraft_snapshot"), None, None))

    def test_geofence_event_passes(self):
        self.assertTrue(apply_subscription_filter(_other_msg("geofence_event"), None, None))

    def test_weather_update_passes(self):
        self.assertTrue(apply_subscription_filter(_other_msg("weather_update"), None, None))


class TestNoFiltersAllEntitiesPass(unittest.TestCase):
    def test_aircraft_passes(self):
        self.assertTrue(apply_subscription_filter(_entity_msg("aircraft"), None, None))

    def test_vessel_passes(self):
        self.assertTrue(apply_subscription_filter(_entity_msg("vessel"), None, None))

    def test_mesh_node_passes(self):
        self.assertTrue(apply_subscription_filter(_entity_msg("mesh_node"), None, None))

    def test_entity_without_position_passes(self):
        self.assertTrue(apply_subscription_filter(_entity_msg("aircraft", None, None), None, None))


class TestBboxFilter(unittest.TestCase):
    def test_entity_inside_bbox_passes(self):
        self.assertTrue(apply_subscription_filter(_entity_msg("aircraft", 45.5, -122.3), _BBOX_INSIDE, None))

    def test_entity_outside_bbox_fails(self):
        self.assertFalse(apply_subscription_filter(_entity_msg("aircraft", 45.5, -122.3), _BBOX_OUTSIDE, None))

    def test_entity_on_bbox_boundary_passes(self):
        # Exactly on the edge: lat=45.0, lon=-123.0 (min corner)
        bbox = (-123.0, 45.0, -122.0, 46.0)
        self.assertTrue(apply_subscription_filter(_entity_msg("aircraft", 45.0, -123.0), bbox, None))

    def test_entity_with_no_lat_passes_bbox_filter(self):
        """Entity with no position should pass — can't exclude what we can't place."""
        self.assertTrue(apply_subscription_filter(_entity_msg("aircraft", None, None), _BBOX_INSIDE, None))

    def test_entity_with_no_lon_passes_bbox_filter(self):
        msg = {"type": "entity_update", "data": {"entity_type": "aircraft", "lat": 45.5, "lon": None}}
        self.assertTrue(apply_subscription_filter(msg, _BBOX_INSIDE, None))

    def test_entity_outside_lat_range_fails(self):
        # lon inside but lat outside
        bbox = (-123.0, 45.0, -122.0, 45.4)  # max_lat=45.4
        self.assertFalse(apply_subscription_filter(_entity_msg("aircraft", 45.5, -122.3), bbox, None))

    def test_entity_outside_lon_range_fails(self):
        # lat inside but lon outside
        bbox = (-122.5, 45.0, -122.2, 46.0)  # min_lon=-122.5, but entity lon=-122.3 is inside
        self.assertTrue(apply_subscription_filter(_entity_msg("aircraft", 45.5, -122.3), bbox, None))
        # now push entity lon outside
        bbox2 = (-123.0, 45.0, -122.5, 46.0)  # max_lon=-122.5; entity at -122.3 is outside
        self.assertFalse(apply_subscription_filter(_entity_msg("aircraft", 45.5, -122.3), bbox2, None))

    def test_no_bbox_all_entities_pass(self):
        self.assertTrue(apply_subscription_filter(_entity_msg("aircraft", 0.0, 0.0), None, None))


class TestEntityTypeFilter(unittest.TestCase):
    def test_matching_type_passes(self):
        self.assertTrue(apply_subscription_filter(
            _entity_msg("aircraft"), None, ["aircraft"]
        ))

    def test_non_matching_type_fails(self):
        self.assertFalse(apply_subscription_filter(
            _entity_msg("vessel"), None, ["aircraft"]
        ))

    def test_multiple_allowed_types_pass(self):
        self.assertTrue(apply_subscription_filter(
            _entity_msg("vessel"), None, ["aircraft", "vessel"]
        ))

    def test_entity_type_not_in_list_fails(self):
        self.assertFalse(apply_subscription_filter(
            _entity_msg("mesh_node"), None, ["aircraft", "vessel"]
        ))

    def test_empty_type_list_treated_as_no_filter(self):
        """Empty list [] means no filter — all types pass."""
        # sub_entity_types=[] is falsy, so no filter applied
        self.assertTrue(apply_subscription_filter(_entity_msg("aircraft"), None, []))

    def test_no_type_filter_all_types_pass(self):
        for etype in ("aircraft", "vessel", "mesh_node", "vehicle", "person"):
            self.assertTrue(apply_subscription_filter(_entity_msg(etype), None, None))


class TestCombinedFilters(unittest.TestCase):
    def test_inside_bbox_and_matching_type_passes(self):
        self.assertTrue(apply_subscription_filter(
            _entity_msg("aircraft", 45.5, -122.3),
            _BBOX_INSIDE,
            ["aircraft"],
        ))

    def test_inside_bbox_but_wrong_type_fails(self):
        self.assertFalse(apply_subscription_filter(
            _entity_msg("vessel", 45.5, -122.3),
            _BBOX_INSIDE,
            ["aircraft"],
        ))

    def test_correct_type_but_outside_bbox_fails(self):
        self.assertFalse(apply_subscription_filter(
            _entity_msg("aircraft", 45.5, -122.3),
            _BBOX_OUTSIDE,
            ["aircraft"],
        ))

    def test_wrong_type_and_outside_bbox_fails(self):
        self.assertFalse(apply_subscription_filter(
            _entity_msg("vessel", 45.5, -122.3),
            _BBOX_OUTSIDE,
            ["aircraft"],
        ))

    def test_no_position_correct_type_passes(self):
        """No position + matching type: bbox passes (no-position rule), type passes."""
        self.assertTrue(apply_subscription_filter(
            _entity_msg("aircraft", None, None),
            _BBOX_INSIDE,
            ["aircraft"],
        ))

    def test_no_position_wrong_type_fails(self):
        """No position + wrong type: type filter still rejects."""
        self.assertFalse(apply_subscription_filter(
            _entity_msg("vessel", None, None),
            _BBOX_INSIDE,
            ["aircraft"],
        ))


class TestMessageStructureEdgeCases(unittest.TestCase):
    def test_entity_update_missing_data_key_passes(self):
        """If data key is missing entirely, filters cannot reject (no info to match)."""
        msg = {"type": "entity_update"}
        # entity_type is None -> not in ["aircraft"] -> should fail type filter
        self.assertFalse(apply_subscription_filter(msg, None, ["aircraft"]))

    def test_entity_update_missing_type_passes_without_type_filter(self):
        msg = {"type": "entity_update", "data": {}}
        self.assertTrue(apply_subscription_filter(msg, None, None))

    def test_unknown_message_type_passes(self):
        msg = {"type": "some_future_message_type", "data": {}}
        self.assertTrue(apply_subscription_filter(msg, None, None))
        self.assertTrue(apply_subscription_filter(msg, _BBOX_INSIDE, ["aircraft"]))

    def test_serialized_json_round_trip(self):
        """Simulates receiving a message as JSON text and parsing it."""
        original = _entity_msg("aircraft", 45.5, -122.3)
        serialized = json.dumps(original)
        parsed = json.loads(serialized)
        self.assertTrue(apply_subscription_filter(parsed, _BBOX_INSIDE, ["aircraft"]))


if __name__ == "__main__":
    unittest.main()
