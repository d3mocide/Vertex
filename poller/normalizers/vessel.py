from datetime import datetime, timezone
import math
from typing import Optional
from sanitize import safe_stripped
from enrichment.vessel_type import decode_ship_type, decode_nav_status

# In-memory cache for AIS static data (message type 5 / ShipStaticData).
# Keyed by MMSI string. Populated when static messages arrive; merged into
# every subsequent position report for that vessel.
_static_cache: dict[str, dict] = {}


def _number(value, low, high):
    if value is None or isinstance(value, bool): return None
    try: value = float(value)
    except (ValueError, TypeError): return None
    return value if math.isfinite(value) and low <= value < high else None


def _received_time(value, now):
    """Source receive time, not the AIS seconds-within-a-minute field."""
    if value is None: return now, 'local_receipt'
    try:
        if isinstance(value, (float, int)):
            result = float(value)
        else:
            text = str(value).strip().removesuffix(' UTC').replace(' +0000', '+00:00')
            if len(text) == 14 and text.isdigit():
                parsed = datetime.strptime(text, '%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
            else:
                parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
                if parsed.tzinfo is None: parsed = parsed.replace(tzinfo=timezone.utc)
            result = parsed.timestamp()
        if math.isfinite(result) and 0 < result <= now+30:
            return result, 'source_receipt'
    except (ValueError, TypeError, OverflowError): pass
    # An invalid supplied clock must not make an old position look fresh.
    return None, 'unknown'


def _motion(identity, speed, course, heading, received):
    now = datetime.fromisoformat(_now()).timestamp()
    timestamp, time_source = _received_time(received, now)
    identity.update({'course_over_ground': _number(course, 0, 360),
                     'true_heading': _number(heading, 0, 360),
                     'position_time_source': time_source})
    return {'speed': _number(speed, 0, 102.3), 'heading': identity['course_over_ground'],
            'position_ts': timestamp,
            'position_age_s': max(0, now-timestamp) if timestamp is not None else None,
            'position_stale': timestamp is None or now-timestamp > 90,
            'last_seen': datetime.fromtimestamp(timestamp or now, timezone.utc).isoformat()}


def _coordinates(lat, lon):
    lat = _number(lat, -90, 91)
    lon = _number(lon, -180, 181)
    return (lat, lon) if lat is not None and lon is not None and lat <= 90 and lon <= 180 else None


def normalize_aisstream(data: dict) -> Optional[dict]:
    meta = data.get("MetaData", {})
    mmsi = str(meta.get("MMSI", ""))
    if not mmsi or mmsi in {'None', '0'}:
        return None
    msg_type = data.get("MessageType", "")
    msg = data.get("Message", {})

    if msg_type == "ShipStaticData":
        _cache_aisstream_static(mmsi, msg.get("ShipStaticData", {}))
        return None  # no position to publish

    if msg_type in {"PositionReport", "StandardClassBPositionReport"}:
        pr = msg.get(msg_type, {})
        if pr.get('Valid') is False: return None
        lat = pr.get('Latitude')
        lon = pr.get('Longitude')
        if lat is None: lat = meta.get('Latitude', meta.get('latitude'))
        if lon is None: lon = meta.get('Longitude', meta.get('longitude'))
        coordinates = _coordinates(lat, lon)
        if coordinates is None: return None
        ship_name = safe_stripped(meta.get("ShipName"), mmsi)

        nav_code = pr.get("NavigationalStatus")
        nav_label = decode_nav_status(nav_code)

        identity: dict = {"mmsi": mmsi, "ship_name": safe_stripped(meta.get("ShipName"))}
        if nav_label:
            identity["nav_status"] = nav_label

        # Merge any cached static data for this vessel
        identity.update(_static_cache.get(mmsi, {}))
        motion = _motion(identity, pr.get('Sog'), pr.get('Cog'), pr.get('TrueHeading'), meta.get('time_utc'))

        return {
            "entity_id": f"vessel:{mmsi}",
            "entity_type": "vessel",
            "source": "aisstream",
            "display_name": ship_name,
            "identity": identity,
            "lat": coordinates[0],
            "lon": coordinates[1],
            **motion,
            "status": nav_label or str(nav_code or ""),
            "tags": ["vessel"],
        }
    return None


def normalize_ais_catcher(data: dict) -> Optional[dict]:
    mmsi = str(data.get("mmsi", ""))
    if not mmsi or data.get("lat") is None or data.get("lon") is None:
        return None
    coordinates = _coordinates(data.get('lat'), data.get('lon'))
    if coordinates is None: return None

    ship_name = safe_stripped(data.get("shipname"), mmsi)

    ship_type_code = data.get("shiptype")
    ship_type_label, _ = decode_ship_type(ship_type_code)

    nav_code = data.get("status")
    nav_label = decode_nav_status(nav_code)

    # AIS-catcher merges static + dynamic fields into one JSON blob
    imo_raw = data.get("imo")
    imo = str(int(imo_raw)) if imo_raw and str(imo_raw).isdigit() and int(imo_raw) > 0 else None

    destination = safe_stripped(data.get("destination"))
    callsign = safe_stripped(data.get("callsign"))
    draught = data.get("draught") or data.get("maxdraught")

    # Vessel dimensions: AIS-catcher reports bow/stern/port/starboard offsets
    dim_bow = data.get("to_bow")
    dim_stern = data.get("to_stern")
    dim_port = data.get("to_port")
    dim_starboard = data.get("to_starboard")
    length: int | None = None
    width: int | None = None
    if dim_bow is not None and dim_stern is not None:
        try:
            length = int(dim_bow) + int(dim_stern)
        except (TypeError, ValueError):
            pass
    if dim_port is not None and dim_starboard is not None:
        try:
            width = int(dim_port) + int(dim_starboard)
        except (TypeError, ValueError):
            pass

    identity: dict = {
        "mmsi": mmsi,
        "ship_name": safe_stripped(data.get("shipname")),
    }
    if ship_type_label:
        identity["ship_type"] = ship_type_label
    if ship_type_code is not None:
        identity["ship_type_code"] = int(ship_type_code)
    if nav_label:
        identity["nav_status"] = nav_label
    if callsign:
        identity["callsign"] = callsign
    if imo:
        identity["imo"] = imo
    if destination:
        identity["destination"] = destination
    if draught:
        try:
            identity["draught"] = float(draught)
        except (TypeError, ValueError):
            pass
    if length:
        identity["length_m"] = length
    if width:
        identity["width_m"] = width
    received = next((data[key] for key in ('toa', 'rxuxtime', 'rxtime', 'timestamp')
                     if data.get(key) is not None), None)
    motion = _motion(identity, data.get('speed'), data.get('course'), data.get('heading'), received)

    return {
        "entity_id": f"vessel:{mmsi}",
        "entity_type": "vessel",
        "source": "ais-catcher",
        "display_name": ship_name,
        "identity": identity,
        "lat": coordinates[0],
        "lon": coordinates[1],
        **motion,
        "status": nav_label or str(nav_code or ""),
        "signal_quality": data.get("rssi"),
        "tags": ["vessel"],
    }


def _cache_aisstream_static(mmsi: str, sd: dict) -> None:
    """Extract and cache static vessel fields from an AISstream ShipStaticData message."""
    entry: dict = {}

    callsign = safe_stripped(sd.get("CallSign"))
    if callsign:
        entry["callsign"] = callsign

    imo_raw = sd.get("ImoNumber")
    if imo_raw and int(imo_raw) > 0:
        entry["imo"] = str(int(imo_raw))

    ship_type_code = sd.get("Type")
    if ship_type_code is not None:
        label, _ = decode_ship_type(ship_type_code)
        if label:
            entry["ship_type"] = label
        entry["ship_type_code"] = int(ship_type_code)

    draught = sd.get("MaximumStaticDraught")
    if draught:
        try:
            entry["draught"] = float(draught)
        except (TypeError, ValueError):
            pass

    destination = safe_stripped(sd.get("Destination"))
    if destination:
        entry["destination"] = destination

    eta = sd.get("Eta")
    if isinstance(eta, dict):
        eta_str = _format_eta(eta)
        if eta_str:
            entry["eta"] = eta_str

    dim = sd.get("Dimension")
    if isinstance(dim, dict):
        a = dim.get("A", 0) or 0  # bow
        b = dim.get("B", 0) or 0  # stern
        c = dim.get("C", 0) or 0  # port
        d = dim.get("D", 0) or 0  # starboard
        if int(a) + int(b) > 0:
            entry["length_m"] = int(a) + int(b)
        if int(c) + int(d) > 0:
            entry["width_m"] = int(c) + int(d)

    if entry:
        _static_cache[mmsi] = entry


def _format_eta(eta: dict) -> str | None:
    """Format an AISstream ETA dict {Month, Day, Hour, Minute} → 'MM-DD HH:MM'."""
    try:
        month = int(eta.get("Month", 0))
        day = int(eta.get("Day", 0))
        hour = int(eta.get("Hour", 24))
        minute = int(eta.get("Minute", 60))
        if month == 0 and day == 0:
            return None
        hour_str = f"{hour:02d}" if hour < 24 else "--"
        min_str = f"{minute:02d}" if minute < 60 else "--"
        return f"{month:02d}-{day:02d} {hour_str}:{min_str}"
    except (TypeError, ValueError):
        return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
