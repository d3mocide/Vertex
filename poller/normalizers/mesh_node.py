from datetime import datetime, timezone
from typing import Optional


def normalize_mesh_node(data: dict) -> Optional[dict]:
    """Normalize a MeshCore bridge node_update payload to canonical Entity."""
    node_id = data.get("entity_id", "").replace("mesh_node:", "") or data.get("identity", {}).get("node_id")
    if not node_id:
        return None

    # Bridge may send a pre-built entity or a raw node dict
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
        "status":   _status(data),
        "last_seen": data.get("timestamp") or _now(),
        "tags":     ["mesh_node"],
    }


def _status(node: dict) -> str:
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
