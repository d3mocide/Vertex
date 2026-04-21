from typing import Optional


def _degrees_to_compass(deg: Optional[float]) -> str:
    if deg is None:
        return ""
    val = int((deg / 22.5) + .5)
    dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    return dirs[val % 16]


def normalize_observation(data: dict) -> dict:
    props = data.get("properties", {})
    temp_c = _val(props.get("temperature"))
    wind_kmh = _val(props.get("windSpeed"))
    
    return {
        "station": props.get("station", ""),
        "timestamp": props.get("timestamp"),
        "temp_f": round(temp_c * 9/5 + 32, 1) if temp_c is not None else None,
        "wind_mph": round(wind_kmh * 0.621371, 1) if wind_kmh is not None else None,
        "wind_dir": _degrees_to_compass(_val(props.get("windDirection"))),
        "condition": props.get("textDescription", ""),
        "humidity": round(_val(props.get("relativeHumidity")) or 0),
    }


def normalize_alerts(data: dict) -> list[dict]:
    alerts = []
    for feat in data.get("features", []):
        props = feat.get("properties", {})
        alerts.append({
            "id": props.get("id", ""),
            "event": props.get("event", ""),
            "severity": props.get("severity", ""),
            "urgency": props.get("urgency", ""),
            "headline": props.get("headline", ""),
            "description": props.get("description", ""),
            "effective": props.get("effective"),
            "expires": props.get("expires"),
            "area_desc": props.get("areaDesc", ""),
        })
    return alerts


def _val(obj: Optional[dict]) -> Optional[float]:
    return obj.get("value") if obj else None
