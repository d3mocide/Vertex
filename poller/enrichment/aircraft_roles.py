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
    ("fire", [r"\bFIRE (DEPARTMENT|DEPT|DISTRICT|RESCUE|AND RESCUE|SERVICE|PROTECTION|AVIATION|& RESCUE)\b",
              r"FIREFIGHT", r"FORESTRY", r"FOREST SERVICE", r"INTERAGENCY", r"AIR TANKER", r"HELITANKER"]),
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

# Callsign prefixes (followed by digits) that were checked against real data — an ICAO airline
# designator is only useful when we know who owns it, so nothing here is a guess. (An earlier "AMF" =
# air medical guess was wrong: AMF is Ameriflight, a cargo carrier.)
#   REH     REACH Air Medical Services (hexdb.io OperatorFlagCode for its aircraft)
#   RCH/PAT US Air Mobility Command "Reach" / US Army "Priority Air Transport"
#   TANKER/RESCUE/DUSTOFF  words dispatchers and crews use on air
_CALLSIGN_PREFIXES: dict[str, str] = {
    "REH": "medical",
    "RESCUE": "rescue",
    "TANKER": "fire",
    "RCH": "military", "DUSTOFF": "military", "PAT": "military",
}

# Life Flight Network marks its helicopters N###LF. Individuals hold N###LF numbers too (a Van's RV-7
# among them), so the marking only counts on a rotorcraft.
_LF_REGISTRATION = re.compile(r"^N\d{1,3}LF$")
_ROTORCRAFT_TYPES = {
    "R22", "R44", "R66", "B06", "B407", "B412", "B429", "B430", "B505", "EC20", "EC30", "EC35", "EC45", "EC55",
    "AS50", "AS55", "AS65", "AS32", "A109", "A119", "A139", "A169", "S76", "S92", "H60", "H47", "H46", "H500",
    "MD52", "MD60", "MD90", "MD50", "EXPL", "S61", "S64", "B105", "B06T",
}

# Owner lists ("BANK X TRUST, OPERATOR Y, HARTFORD FIRE INSURANCE CO") carry lenders and insurers.
_FINANCE = re.compile(r"INSURANCE|\bBANK\b|\bTRUST\b|FINANCIAL|CREDIT UNION|MORTGAGE|\bCAPITAL\b|FUNDING", re.I)

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


def _is_rotorcraft(identity: dict) -> bool:
    cat = str(identity.get("category") or "").upper()
    return cat in ("A7", "7") or str(identity.get("icao_type") or "").upper() in _ROTORCRAFT_TYPES


def classify_aircraft(identity: dict) -> tuple[str, str] | None:
    """(role, reason) or None. `identity` is the enriched aircraft identity dict."""
    operator = str(identity.get("operator") or "").upper()
    if operator:
        # Owners come as "A, B, C" — judge each party, skipping lenders and insurers.
        parties = [s.strip() for s in operator.split(",") if s.strip() and not _FINANCE.search(s)]
        for role, patterns in _COMPILED_OPERATORS:
            for party in parties:
                for p in patterns:
                    if p.search(party):
                        return role, f"operator: {identity.get('operator')}"

    callsign = str(identity.get("callsign") or "").strip().upper()
    if callsign:
        for prefix, role in _CALLSIGN_PREFIXES.items():
            # "LIFE" style prefixes need a digit after (LIFE2) so ordinary words don't match.
            if callsign.startswith(prefix) and len(callsign) > len(prefix) and callsign[len(prefix)].isdigit():
                return role, f"callsign {callsign}"

    reg = str(identity.get("registration") or "").strip().upper()
    if reg and _LF_REGISTRATION.match(reg) and _is_rotorcraft(identity):
        return "medical", "registration N###LF on a helicopter (Life Flight Network)"

    icao24 = str(identity.get("icao24") or "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{6}", icao24) and _MIL_HEX[0] <= int(icao24, 16) <= _MIL_HEX[1]:
        return "military", "US military ICAO block"

    if (identity.get("squawk") or "") == "1255":
        return "fire", "squawk 1255 (firefighting)"

    return None
