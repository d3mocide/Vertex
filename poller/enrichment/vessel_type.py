# ITU ship type codes (AIS message field "Type of ship and cargo type")
# Values 0-99; codes not listed here are unassigned or reserved.
_SHIP_TYPE_TABLE: dict[int, tuple[str, str]] = {
    20: ("Wing in Ground", "wig"),
    21: ("Wing in Ground — Hazardous A", "wig"),
    22: ("Wing in Ground — Hazardous B", "wig"),
    23: ("Wing in Ground — Hazardous C", "wig"),
    24: ("Wing in Ground — Hazardous D", "wig"),
    29: ("Wing in Ground (other)", "wig"),
    30: ("Fishing", "fishing"),
    31: ("Towing", "tug"),
    32: ("Towing (large)", "tug"),
    33: ("Dredging/Underwater Ops", "special"),
    34: ("Diving Ops", "special"),
    35: ("Military Ops", "military"),
    36: ("Sailing", "sailing"),
    37: ("Pleasure Craft", "recreational"),
    40: ("High-Speed Craft", "hsc"),
    41: ("High-Speed Craft — Hazardous A", "hsc"),
    42: ("High-Speed Craft — Hazardous B", "hsc"),
    43: ("High-Speed Craft — Hazardous C", "hsc"),
    44: ("High-Speed Craft — Hazardous D", "hsc"),
    49: ("High-Speed Craft (other)", "hsc"),
    50: ("Pilot Vessel", "special"),
    51: ("Search and Rescue", "sar"),
    52: ("Tug", "tug"),
    53: ("Port Tender", "special"),
    54: ("Anti-Pollution", "special"),
    55: ("Law Enforcement", "special"),
    58: ("Medical Transport", "special"),
    59: ("Noncombatant", "military"),
    60: ("Passenger", "passenger"),
    61: ("Passenger — Hazardous A", "passenger"),
    62: ("Passenger — Hazardous B", "passenger"),
    63: ("Passenger — Hazardous C", "passenger"),
    64: ("Passenger — Hazardous D", "passenger"),
    69: ("Passenger (other)", "passenger"),
    70: ("Cargo", "cargo"),
    71: ("Cargo — Hazardous A", "cargo"),
    72: ("Cargo — Hazardous B", "cargo"),
    73: ("Cargo — Hazardous C", "cargo"),
    74: ("Cargo — Hazardous D", "cargo"),
    79: ("Cargo (other)", "cargo"),
    80: ("Tanker", "tanker"),
    81: ("Tanker — Hazardous A", "tanker"),
    82: ("Tanker — Hazardous B", "tanker"),
    83: ("Tanker — Hazardous C", "tanker"),
    84: ("Tanker — Hazardous D", "tanker"),
    89: ("Tanker (other)", "tanker"),
    90: ("Other", "other"),
    91: ("Other — Hazardous A", "other"),
    92: ("Other — Hazardous B", "other"),
    93: ("Other — Hazardous C", "other"),
    94: ("Other — Hazardous D", "other"),
    99: ("Other (unspecified)", "other"),
}

# AIS navigational status codes (field "Navigational status", message types 1-3)
_NAV_STATUS_TABLE: dict[int, str] = {
    0: "Under Way",
    1: "At Anchor",
    2: "Not Under Command",
    3: "Restricted Manoeuvrability",
    4: "Constrained by Draught",
    5: "Moored",
    6: "Aground",
    7: "Fishing",
    8: "Sailing",
    11: "Power-Driven Towing Astern",
    12: "Power-Driven Pushing Ahead",
    14: "AIS-SART Active",
    15: "Undefined",
}


def decode_ship_type(code: int | None) -> tuple[str | None, str | None]:
    """Return (label, category) for an ITU ship type code, or (None, None)."""
    if code is None:
        return None, None
    entry = _SHIP_TYPE_TABLE.get(int(code))
    if entry:
        return entry
    # Ranges with no specific entry
    if 21 <= code <= 29:
        return "Wing in Ground", "wig"
    if 41 <= code <= 49:
        return "High-Speed Craft", "hsc"
    if 61 <= code <= 69:
        return "Passenger", "passenger"
    if 71 <= code <= 79:
        return "Cargo", "cargo"
    if 81 <= code <= 89:
        return "Tanker", "tanker"
    if 91 <= code <= 99:
        return "Other", "other"
    return None, None


def decode_nav_status(code: int | str | None) -> str | None:
    """Return a human-readable navigational status string."""
    if code is None:
        return None
    try:
        return _NAV_STATUS_TABLE.get(int(code))
    except (ValueError, TypeError):
        return str(code) if code else None
