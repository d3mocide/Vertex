import json
import math

MAX_GEOJSON_BYTES = 1024 * 1024
MAX_COORDINATE_PAIRS = 10_000
MAX_NESTING_DEPTH = 20


def validate_geojson_limits(value: dict) -> dict:
    try:
        encoded = json.dumps(value, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"GeoJSON is not valid JSON: {exc}") from exc
    if len(encoded.encode("utf-8")) > MAX_GEOJSON_BYTES:
        raise ValueError("GeoJSON payload exceeds 1 MB limit")

    pairs = 0

    def walk(item, depth: int = 0):
        nonlocal pairs
        if depth > MAX_NESTING_DEPTH:
            raise ValueError("GeoJSON nesting is too deep")
        if isinstance(item, dict):
            for child in item.values():
                walk(child, depth + 1)
        elif isinstance(item, list):
            if len(item) >= 2 and all(isinstance(v, (int, float)) for v in item[:2]):
                if not all(math.isfinite(float(v)) for v in item[:2]):
                    raise ValueError("GeoJSON coordinates must be finite")
                pairs += 1
                if pairs > MAX_COORDINATE_PAIRS:
                    raise ValueError("GeoJSON exceeds 10,000 coordinate-pair limit")
            else:
                for child in item:
                    walk(child, depth + 1)

    walk(value)
    return value
