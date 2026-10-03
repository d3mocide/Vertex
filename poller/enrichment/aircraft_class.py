"""
What kind of aircraft is this? One normalised answer from the several partial ones the feeds give.

The ADS-B emitter category arrives in different shapes: community feeds send "A3", our own Beast decoder used to send
a bare "3" (the letter is the set, taken from the message type code), and many aircraft send nothing. The ICAO type
designator ("B738", "C172", "EC35") is known for most aircraft from the tar1090 database, so it fills the gaps.

`classify(identity)` returns (class, basis) where class is one of CLASSES and basis says what decided it
("category", "type" or "category+type"); `normalize_category` is the one place a raw category is cleaned up.
"""
from __future__ import annotations

import re

# class -> label shown in the UI
CLASSES: dict[str, str] = {
    "airliner": "Airliners",
    "business": "Business & regional",
    "light": "Light aircraft",
    "helicopter": "Helicopters",
    "highperf": "High performance",
    "glider": "Gliders & balloons",
    "uav": "Drones",
    "ground": "Ground vehicles",
    "unknown": "Unknown",
}

_CATEGORY_RE = re.compile(r"^([A-D])([0-7])$")

# ADS-B emitter category -> class. A1 light (<15,500 lb), A2 small (to 75,000 lb), A3 large, A4 high-vortex large (B757),
# A5 heavy, A6 high performance (>5 g, >400 kt), A7 rotorcraft; B1 glider, B2 lighter-than-air, B3 parachutist,
# B4 ultralight, B6 UAV, B7 space vehicle; C1 emergency vehicle, C2 service vehicle, C3 obstacle.
_CATEGORY_CLASS: dict[str, str] = {
    "A1": "light", "A2": "business", "A3": "airliner", "A4": "airliner", "A5": "airliner", "A6": "highperf",
    "A7": "helicopter", "B1": "glider", "B2": "glider", "B3": "glider", "B4": "light", "B6": "uav", "B7": "uav",
    "C1": "ground", "C2": "ground", "C3": "ground",
}

_HELICOPTER_TYPES = {
    "R22", "R44", "R66", "B06", "B407", "B412", "B429", "B430", "B505", "EC20", "EC30", "EC35", "EC45", "EC55",
    "AS50", "AS55", "AS65", "AS32", "A109", "A119", "A139", "A169", "S76", "S92", "H60", "H47", "H46", "H500",
    "MD52", "MD60", "MD90", "MD50", "EXPL", "S61", "S64", "B105", "B06T", "H125", "H130", "H135", "H145", "H160",
    "EC25", "EC75", "B212", "B214", "B222", "B230", "B427", "B525", "UH1", "UH1H", "H1", "H64", "CH47", "S58", "S70",
    "AS3B", "AS35", "EN28", "EN48", "R44", "G2CA", "CH53", "H53", "H72", "H500",
}

# Type designators when no usable category came with the position reports. Patterns are anchored; the lists cover
# what flies in practice and are plain data to extend.
_TYPE_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("airliner", re.compile(
        r"^(B73[0-9]|B3[0-9]M|B7[0-9]{2}|B7[0-9][A-Z]|A2[0-9]{2}|A3[0-9]{2}|A[123][0-9]N|E1[0-9]{2}|E7[0-9][A-Z]|E29[0-9]?|"
        r"CRJ[0-9A-Z]|MD8[0-9]|MD9[0-9]|MD11|B712|BCS[0-9]|SU95|F100|F70|RJ[0-9]{2})$")),
    ("business", re.compile(
        r"^(C25[A-Z0-9]|C5[0-9]{2}|C56X|C6[0-9]{2}|C68[0-9A-Z]|C7[0-9]{2}|GLF[0-9A-Z]|G[0-9]{3}|GALX|GL[0-9][0-9A-Z]|FA[0-9][0-9A-Z]|F2TH|"
        r"F900|LJ[0-9]{2}|E5[05]P|PRM1|H25[A-Z]|CL[0-9]{2}|CL[0-9]T|PC12|PC24|TBM[0-9]|SF50|EA50|HDJT|B350|BE20|BE9[0-9L]|"
        r"BE10|BE40|B190|DH8[A-D]|AT[4-7][0-9A-Z]?|SF34|SB20|J41|JS[0-9]{2}|C208|P180|MU2|C441|SW[0-9])$")),
    ("light", re.compile(
        r"^((?!C130$)C1[0-9]{2}|C2[0-9]{2}|C3[0-9]{2}|P28[A-Z0-9]|PA[0-9]{2}|SR2[0-9]|DA[0-9]{2}|M20[A-Z]|RV[0-9]{1,2}[A-Z]?|AA5|"
        r"BE3[0-9]|BE5[0-9]|BE6[0-9]|BE7[0-9]|BE8[0-9]|S22[A-Z]|COZY|LNC[0-9]|PTS[0-9]|GLST|J3|J5|PIVI|EVOT|PIT[0-9]|"
        r"STIC|SLG[0-9]|SKYH)$")),
    ("glider", re.compile(r"^(GLID|ASK[0-9]|DG[0-9]{2,3}|DISC|LS[0-9]|ASG[0-9]|ARCE|BALL|GYRO|PARA)$")),
    ("uav", re.compile(r"^(UAV|DRON|MQ[0-9]|RQ[0-9])$")),
]


def normalize_category(raw: object) -> str | None:
    """'A3' for 'A3', 'a3' or a bare '3'; None for anything unusable (no data, 0, out of range)."""
    text = str(raw or "").strip().upper()
    if not text:
        return None
    if text.isdigit() and len(text) == 1:
        text = "A" + text                    # a bare digit is set A, the one nearly every aircraft uses
    m = _CATEGORY_RE.match(text)
    if not m or m.group(2) == "0":
        return None                          # x0 means "no information"
    return text


def classify_type(icao_type: object) -> str | None:
    """Class from an ICAO type designator alone, or None when it is not recognised."""
    t = str(icao_type or "").strip().upper()
    if not t:
        return None
    if t in _HELICOPTER_TYPES:
        return "helicopter"
    for cls, pattern in _TYPE_RULES:
        if pattern.match(t):
            return cls
    return None


def classify(identity: dict) -> tuple[str, str]:
    """(class, basis) for an enriched aircraft identity."""
    category = normalize_category(identity.get("category"))
    by_category = _CATEGORY_CLASS.get(category) if category else None
    by_type = classify_type(identity.get("icao_type"))
    if by_type == "helicopter" and by_category not in (None, "helicopter"):
        return "helicopter", "type"          # the type is specific, the broadcast category is often a default
    if by_category:
        return by_category, "category+type" if by_type == by_category else "category"
    if by_type:
        return by_type, "type"
    return "unknown", "none"
