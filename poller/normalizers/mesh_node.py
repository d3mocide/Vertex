from datetime import datetime, timezone
from typing import Optional


_CONTACT_TYPES = {
    0: "unknown",
    1: "client",
    2: "repeater",
    3: "room",
    4: "sensor",
}


def normalize_mesh_node(data: dict) -> Optional[dict]:
    """Normalize a MeshCore bridge node_update payload to canonical Entity."""
    node_id = data.get("entity_id", "").replace("mesh_node:", "") or data.get("identity", {}).get("node_id")
    if not node_id:
        return None

    if data.get("entity_type") == "mesh_node":
        return data  # already canonical

    return {
        "entity_id":    f"mesh_node:{node_id}",
        "entity_type":  "mesh_node",
        "source":       "meshcore",
        "display_name": data.get("name") or data.get("short_name") or node_id,
        "identity": {
            "node_id":    node_id,
            "short_name": data.get("short_name", ""),
            "hw_model":   data.get("hw_model", ""),
        },
        "lat":      data.get("lat"),
        "lon":      data.get("lon"),
        "altitude": data.get("altitude"),
        "status":   _bridge_status(data),
        "last_seen": data.get("timestamp") or _now(),
        "tags":     ["mesh_node"],
    }


def normalize_remoteterm_contact(data: dict) -> Optional[dict]:
    """Normalize a RemoteTerm /api/contacts entry to canonical Entity."""
    pub_key = data.get("public_key", "")
    if not pub_key:
        return None

    node_type = _CONTACT_TYPES.get(data.get("type", 0), "unknown")
    name = data.get("name") or pub_key[:12]

    last_seen_raw = data.get("last_seen")
    if isinstance(last_seen_raw, (int, float)):
        last_seen = datetime.fromtimestamp(last_seen_raw, tz=timezone.utc).isoformat()
    elif isinstance(last_seen_raw, str):
        last_seen = last_seen_raw
    else:
        last_seen = _now()

    tags = ["mesh_node", node_type]
    if data.get("on_radio"):
        tags.append("on_radio")
    if data.get("favorite"):
        tags.append("favorite")

    return {
        "entity_id":    f"mesh_node:{pub_key}",
        "entity_type":  "mesh_node",
        "source":       "meshcore",
        "display_name": name,
        "identity": {
            "public_key":   pub_key,
            "node_id":      pub_key[:12],
            "short_name":   pub_key[:12],
            "contact_type": node_type,
            "hw_model":     "",
            "on_radio":     data.get("on_radio", False),
            "favorite":     data.get("favorite", False),
        },
        "lat":      data.get("lat"),
        "lon":      data.get("lon"),
        "altitude": None,
        "status":   _remoteterm_status(data),
        "last_seen": last_seen,
        "tags":     tags,
    }


def _remoteterm_status(contact: dict) -> str:
    parts = []
    effective = contact.get("effective_route")
    if isinstance(effective, dict) and (hops := effective.get("hop_count")) is not None:
        parts.append(f"hops:{hops}")
    return " ".join(parts)


def _bridge_status(node: dict) -> str:
    parts = []
    if (v := node.get("battery_pct")) is not None:
        parts.append(f"bat:{v}%")
    if (v := node.get("snr")) is not None:
        parts.append(f"snr:{v:.1f}")
    if (v := node.get("rssi")) is not None:
        parts.append(f"rssi:{v}")
    return " ".join(parts)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
