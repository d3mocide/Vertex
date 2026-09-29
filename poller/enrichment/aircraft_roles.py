"""
Who is this aircraft for?  Classifies an aircraft as air ambulance, search and
rescue, law enforcement, aerial firefighting, military, news or government from
what we already know about it: the registered owner/operator (adsbdb), the
callsign, the registration, the transponder code and the ICAO address block.

The rules are ordered: the first role that matches wins, life-safety roles first
(a Coast Guard helicopter is "rescue", not "military"). Keyword lists are plain
data — extend them when a new local operator turns up in the flight log.
"""

from __future__ import annotations

import re

# role -> label shown in the UI
ROLES: dict[str, str] = {
    "rescue": "Search & rescue",
    "medical": "Air ambulance",
    "fire": "Aerial firefighting",
    "law_enforcement": "Law enforcement",
    "military": "Military",
    "news": "News / media",
    "government": "Government",
}

# Registered owner / operator keywords (matched against the upper-cased text).
# Word-boundary patterns keep "FIRE" from matching "FIREFLY".
_OPERATOR_RULES: list[tuple[str, list[str]]] = [
    ("rescue", [r"COAST GUARD", r"CIVIL AIR PATROL", r"SEARCH (AND|&) RESCUE", r"\bRESCUE\b"]),
    ("medical", [r"LIFE ?FLIGHT", r"AIR METHODS", r"REACH AIR", r"MERCY FLIGHTS?", r"AIRLINK",
                 r"MED-?EVAC", r"AIR AMBULANCE", r"AIR MEDICAL", r"AEROMEDICAL", r"METRO AVIATION",
                 r"\bPHI AIR", r"LIFENET", r"MED-?TRANS", r"STAT MED"]),
    ("fire", [r"\bFIRE\b", r"FIREFIGHT", r"FORESTRY", r"FOREST SERVICE", r"INTERAGENCY", r"\bTANKER\b",
              r"HELITANKER"]),
    ("law_enforcement", [r"\bPOLICE\b", r"SHERIFF", r"STATE PATROL", r"HIGHWAY PATROL", r"MARSHALS?\b",
                         r"BORDER PROTECTION", r"CUSTOMS", r"HOMELAND SECURITY", r"FEDERAL BUREAU",
                         r"DRUG ENFORCEMENT", r"ALCOHOL, TOBACCO", r"DEPARTMENT OF JUSTICE", r"AIR SUPPORT"]),
    ("military", [r"UNITED STATES (ARMY|AIR FORCE|NAVY|MARINE)", r"\bARMY\b", r"AIR FORCE", r"\bNAVY\b",
                  r"MARINE CORPS", r"NATIONAL GUARD"]),
    ("news", [r"\bKGW\b", r"\bKOIN\b", r"\bKATU\b", r"\bKPTV\b", r"\bNEWS\b", r"BROADCAST", r"TELEVISION"]),
    ("government", [r"BONNEVILLE POWER", r"^STATE OF\b", r"^CITY OF\b", r"^COUNTY OF\b", r"DEPARTMENT OF",
                    r"UNITED STATES OF AMERICA", r"\bNASA\b", r"\bNOAA\b", r"BUREAU OF LAND",
                    r"GEOLOGICAL SURVEY", r"NATIONAL PARK"]),
]
_COMPILED_OPERATORS = [(role, [re.compile(p) for p in pats]) for role, pats in _OPERATOR_RULES]

# ICAO callsign prefixes (3 letters + digits) of operators that fly under their own designator.
_CALLSIGN_PREFIXES: dict[str, str] = {
    "LFN": "medical", "REH": "medical", "AMF": "medical", "LIFE": "medical",
    "RESCUE": "rescue", "CGN": "rescue",
    "TANKER": "fire", "RCH": "military", "DUSTOFF": "military", "PAT": "military",
}

# Registrations that are an operator's fleet marking: Life Flight Network uses N###LF.
_REGISTRATION_RULES: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r"^N\d{1,3}LF$"), "medical", "registration N###LF (Life Flight Network)"),
]

# The US military owns the ICAO block AE0000-AFFFFF.
_MIL_HEX = (0xAE0000, 0xAFFFFF)

# Transponder codes with a fixed meaning; alerts are separate from roles.
_ALERT_SQUAWKS = {
    "7500": "hijack",
    "7600": "radio_failure",
    "7700": "emergency",
    "7400": "uav_lost_link",
}
_ALERT_LABELS = {
    "hijack": "Squawk 7500 — hijack",
    "radio_failure": "Squawk 7600 — radio failure",
    "emergency": "Squawk 7700 — emergency",
    "uav_lost_link": "Squawk 7400 — UAV lost link",
}


def alert_for(squawk: str | None) -> str | None:
    return _ALERT_SQUAWKS.get((squawk or "").strip())


def alert_label(alert: str) -> str:
    return _ALERT_LABELS.get(alert, alert)


def classify_aircraft(identity: dict) -> tuple[str, str] | None:
    """(role, reason) or None. `identity` is the enriched aircraft identity dict."""
    operator = str(identity.get("operator") or "").upper()
    if operator:
        for role, patterns in _COMPILED_OPERATORS:
            for p in patterns:
                if p.search(operator):
                    return role, f"operator: {identity.get('operator')}"

    callsign = str(identity.get("callsign") or "").strip().upper()
    if callsign:
        for prefix, role in _CALLSIGN_PREFIXES.items():
            # "LIFE" style prefixes need a digit after (LIFE2) so ordinary words don't match.
            if callsign.startswith(prefix) and len(callsign) > len(prefix) and callsign[len(prefix)].isdigit():
                return role, f"callsign {callsign}"

    reg = str(identity.get("registration") or "").strip().upper()
    for pattern, role, why in _REGISTRATION_RULES:
        if reg and pattern.match(reg):
            return role, why

    icao24 = str(identity.get("icao24") or "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{6}", icao24) and _MIL_HEX[0] <= int(icao24, 16) <= _MIL_HEX[1]:
        return "military", "US military ICAO block"

    if (identity.get("squawk") or "") == "1255":
        return "fire", "squawk 1255 (firefighting)"

    return None
