from typing import Optional


def normalize_observation(data: dict) -> dict:
    props = data.get("properties", {})
    return {
        "station": props.get("station", ""),
        "timestamp": props.get("timestamp"),
        "temperature_c": _val(props.get("temperature")),
        "dewpoint_c": _val(props.get("dewpoint")),
        "wind_direction_deg": _val(props.get("windDirection")),
        "wind_speed_kmh": _val(props.get("windSpeed")),
        "barometric_pressure_pa": _val(props.get("barometricPressure")),
        "visibility_m": _val(props.get("visibility")),
        "relative_humidity_pct": _val(props.get("relativeHumidity")),
        "present_weather": [w.get("weather") for w in (props.get("presentWeather") or [])],
        "text_description": props.get("textDescription", ""),
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
