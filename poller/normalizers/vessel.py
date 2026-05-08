from datetime import datetime, timezone
from typing import Optional
from sanitize import safe_stripped


def normalize_aisstream(data: dict) -> Optional[dict]:
    meta = data.get("MetaData", {})
    mmsi = str(meta.get("MMSI", ""))
    if not mmsi:
        return None
    msg_type = data.get("MessageType", "")
    msg = data.get("Message", {})

    if msg_type == "PositionReport":
        pr = msg.get("PositionReport", {})
        ship_name = safe_stripped(meta.get("ShipName"), mmsi)
        return {
            "entity_id": f"vessel:{mmsi}",
            "entity_type": "vessel",
            "source": "aisstream",
            "display_name": ship_name,
            "identity": {"mmsi": mmsi, "ship_name": safe_stripped(meta.get("ShipName"))},
            "lat": pr.get("Latitude") or meta.get("latitude"),
            "lon": pr.get("Longitude") or meta.get("longitude"),
            "heading": pr.get("TrueHeading"),
            "speed": pr.get("Sog"),
            "status": str(pr.get("NavigationalStatus", "")),
            "last_seen": _now(),
            "tags": ["vessel"],
        }
    return None


def normalize_ais_catcher(data: dict) -> Optional[dict]:
    mmsi = str(data.get("mmsi", ""))
    if not mmsi or data.get("lat") is None or data.get("lon") is None:
        return None
    ship_name = safe_stripped(data.get("shipname"), mmsi)
    return {
        "entity_id": f"vessel:{mmsi}",
        "entity_type": "vessel",
        "source": "ais-catcher",
        "display_name": ship_name,
        "identity": {
            "mmsi": mmsi,
            "ship_name": safe_stripped(data.get("shipname")),
            "ship_type": data.get("shiptype"),
        },
        "lat": data.get("lat"),
        "lon": data.get("lon"),
        "heading": data.get("heading"),
        "speed": data.get("speed"),
        "status": str(data.get("status", "")),
        "last_seen": _now(),
        "tags": ["vessel"],
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
