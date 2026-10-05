"""
Deterministic incident extraction from P25 dispatch transcripts.

Dispatch audio follows a fairly rigid pattern —

    "<units>, a priority <n> <MPDS level> <nature>, <place>, <address>,
     talk group is Ops <n>, timeout <hhmm>"

— usually read twice per transmission and followed later by on-scene,
recall and clear traffic. This module turns noisy ASR text (either clean
"3355 Southeast 70th Avenue" or spelled-out "four zero two northeast
second avenue") into structured incidents and clusters repeat calls about
the same address, so downstream consumers (the AI briefing, the Incidents
page) get "structure fire at 402 NE 2nd Ave, 4 calls, Engine 1 + Truck 13"
instead of thirty garbled lines.

Everything here is pure and synchronous so it can be unit-tested against
real transcripts.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta

# ── Number normalisation ─────────────────────────────────────────────────────

_UNITS = {
    "zero": 0, "oh": 0, "o": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19,
}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
         "seventy": 70, "eighty": 80, "ninety": 90}
_ORDINALS = {
    "first": "1st", "second": "2nd", "third": "3rd", "fourth": "4th", "fifth": "5th",
    "sixth": "6th", "seventh": "7th", "eighth": "8th", "ninth": "9th", "tenth": "10th",
    "eleventh": "11th", "twelfth": "12th", "thirteenth": "13th", "fourteenth": "14th",
    "fifteenth": "15th", "sixteenth": "16th", "seventeenth": "17th", "eighteenth": "18th",
    "nineteenth": "19th", "twentieth": "20th", "thirtieth": "30th",
}
_NUMBER_WORD = "|".join(sorted([*_UNITS, *_TENS, "hundred"], key=len, reverse=True))
_NUM_RUN = re.compile(rf"\b(?:(?:{_NUMBER_WORD})\b[\s-]*)+", re.I)


def _words_to_digits(run: str) -> str:
    """'three zero one' -> '301', 'forty four' -> '44', 'one twenty five' -> '125'."""
    words = [w for w in re.split(r"[\s-]+", run.lower().strip()) if w]
    out: list[str] = []
    i = 0
    while i < len(words):
        w = words[i]
        if w in _TENS:
            val = _TENS[w]
            if i + 1 < len(words) and words[i + 1] in _UNITS and 0 < _UNITS[words[i + 1]] < 10:
                val += _UNITS[words[i + 1]]
                i += 1
            out.append(str(val))
        elif w == "hundred":
            if out:
                out[-1] = str(int(out[-1]) * 100)
        elif w in _UNITS:
            out.append(str(_UNITS[w]))
        i += 1
    return "".join(out)


def normalise(text: str) -> str:
    """Lower-case, spell numbers as digits, collapse whitespace, drop punctuation noise."""
    t = text.lower()
    t = re.sub(r"(\d),(\d{3})\b", r"\1\2", t)          # 12,345 -> 12345
    t = re.sub(r"\b\d(?:-\d){2,6}\b", lambda m: m.group(0).replace("-", ""), t)   # "2-0-3-0-5" read digit by digit -> 20305
    t = _NUM_RUN.sub(lambda m: " " + _words_to_digits(m.group(0)) + " ", t)
    for word, ordinal in _ORDINALS.items():
        t = re.sub(rf"\b{word}\b", ordinal, t)
    t = re.sub(r"\b(\d+)\s+(st|nd|rd|th)\b", r"\1\2", t)
    t = re.sub(r"[^\w\s/&-]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# ── Nature / severity ────────────────────────────────────────────────────────

# (category, severity 1-5, pattern) — first match wins, so order matters.
#
# Transcripts are single ASR'd transmissions from dispatch, field crews AND hospital/EMS patient reports, so a
# bare keyword is rarely enough: "give it a shot", "shooting pain", "stabbing pain", "the patient collapsed",
# "not an entrapment", "our MVC lost its connection" and "canceled by fire" all appear far more often than the
# incidents those words suggest. Patterns therefore describe the *incident* ("been shot", "stabbing wound",
# "structure collapse", "miscellaneous fire at ...") and negated mentions are discarded (see _negated()).
_NATURES: list[tuple[str, int, re.Pattern]] = [
    # "Water Rescue 20" and "water rescue call" are apparatus, not an incident.
    ("water_rescue", 5, re.compile(r"water rescue(?!\s*\d)(?! call)|in the water|person in (the )?water|jumper (?:on|off|from|at|near) (?:the |a )?(?:\w+ )?(?:bridge|overpass)|on the railing|fireboat|swift ?water")),
    # "(?! alarm)": "commercial fire alarm" is an alarm, not a fire; "(?!\w)": "residential firelight" is not a fire.
    ("structure_fire", 5, re.compile(r"(?:structure|house|apartment|residential|commercial|working) fire(?! alarm)(?!\w)|fire in (a|the) (building|house|apartment|unit)|smoke (in|from) (the |a )?(building|house|apartment|residence)")),
    ("violence", 4, re.compile(
        r"gunshot|shots? fired|stabbing wound|\bstabbed\b|\bstabbing\b(?! (?:pain|sensation|feeling))"
        r"|\b(?:been|was|were|got|get|being|gets) shot (?:in|to|at|by|twice|multiple|once|and|while|during|several|with)\b|\bshot (?:himself|herself|themselves|in the|to the|in his|in her|twice|multiple|and (?:killed|wounded))"
        r"|(?:report of|reported|call for|respond(?:ing)? to|possible) (?:a |an )?shooting\b|\bshooting (?:victim|incident|suspect|in progress|toward|towards)")),
    ("rescue", 4, re.compile(r"entrap|trapped|high angle|confined space|technical rescue|extrication|(?:structure|building|roof|wall|floor|trench|house|garage|ceiling|deck|stairs?) collapse|collapsed (?:building|structure|roof|wall|trench)")),
    ("hazmat", 4, re.compile(r"hazmat|hazardous material|fuel spill|chemical (spill|leak)")),
    ("gas_leak", 4, re.compile(r"gas (leak|odor|smell)|odor of gas|smell of gas|natural gas|gas line")),
    ("carbon_monoxide", 4, re.compile(r"carbon mon\w*|\bco alarm")),
    ("train_or_ped_struck", 4, re.compile(r"(pedestrian|person) struck|struck by (a |an )?(car|vehicle|train|freight)|train vs|versus (a )?train")),
    ("crash", 3, re.compile(r"traffic accident|motor vehicle (accident|crash|collision)|(?<!our )(?<!my )\bmvc\b(?! (?:doesn|isn|has|is not|lost|connection))|\bmva\b|rollover|\bcollision\b|\bcrash(?:ed)?\b(?! (?:cart|into the (?:room|helicopter)))")),
    ("vehicle_fire", 3, re.compile(r"(car|vehicle|auto|truck|rv) fire")),
    ("outside_fire", 3, re.compile(r"vegetation|brush fire|grass fire|tree (is )?on fire|bark ?dust|outside fire|dumpster fire|trash fire|debris fire|smoke investigation|illegal burn|smoke in the area|(?:grass|brush|bush|tree|garbage|trash) (?:can )?on fire|\bfire on the (?:stoop|porch|deck|patio|balcony|roof|fence|lawn)")),
    ("assault", 3, re.compile(r"assault")),
    # Time-critical medical calls: serious, but routine enough (a few a day) to stay below the must-cover tier.
    ("critical_medical", 3, re.compile(r"(?:cardiac|respiratory) arrest|\bcpr (?:in progress|is being|being)|performing cpr|compressions in progress|\bchoking\b|\b(?:near )?drowning\b|suicid(?:e|al)|overdose (?:with|and) (?:no|not)")),
    ("fire_alarm", 1, re.compile(r"fire alarm|commercial alarm|unverified alarm|smoke alarm|alarm activation|fire (?:pull )?station alarm|(?:residential|commercial) fire ?(?:arms?|light)\b")),
    # A bare "fire" is overwhelmingly the agency ("canceled by fire", "fire com", "fire attack", "fire company"), so a
    # generic fire needs dispatch phrasing: a qualifier or "respond to ... fire", ideally with a place.
    ("fire", 3, re.compile(
        r"(?<!non-)\b(?:miscellaneous|misc|small|unknown(?: type)?|type unclear|possible|reported|medium|large|major|working|warming|wildland|forest|extinguished|outside|backyard|electrical|gasoline|propane|oil|power ?line|barn|shed|garage|fence|trailer|boat|tree|bush|deck|pallet|wood ?pile) fire\b(?! (?:alarm|department|dispatch|station|engine|district|marshal|boat|ops|crews?|com\b|attack|company|call|watch|supply|ground|command|investigat\w*|tac\b|response|unit|rider|drill|prior))"
        r"|(?<=respond to )fire (?:at|on|near)\b|(?<=respond to a )fire (?:at|on|near)\b|(?<=responding to )fire (?:at|on|near)\b"
        r"|\b(?:on|catching|caught) fire\b(?! (?:alarm|department|dispatch|station|engine|district|marshal|boat|ops|crews?|com\b|attack|company|call|watch|supply|ground|command|investigat\w*|tac\b|response|unit|rider|drill|prior))"
        r"|\bfire in (?:a |an |the |our |his |her |their )?(?:\w+ ){0,2}(?:bathroom|kitchen|boat|street|backyard|yard|garage|attic|basement|bedroom|room|vent|chimney|dumpster|field|woods|shed|barn|trailer|car|vehicle|elevator|shaft|walls?|ceiling|roof|hallway|stairwell|laundry)\b"
        r"|(?<!test )(?<!information )(?<!info )(?<!non-)(?<!non )\bfire(?= at \d)")),
    ("medical", 1, re.compile(r"sick person|breathing problem|\bfall\b|unconscious|chest pain|seizure|abdominal|psychiatric|overdose|diabetic|stroke|cardiac|allergic|bleeding|lift assist|medical alarm|sick|injur|pain|breathing|faint|welfare check|intoxicated")),
]
_NEGATORS = {"no", "not", "never", "without", "nobody", "none", "negative", "t"}   # "t" = the n't in "doesn't" etc.


def _negated(t: str, start: int) -> bool:
    """True when one of the 5 words before `start` negates the match ("no entrapment", "not an entrapment", "doesn't think anybody is trapped")."""
    words = t[:start].split()[-5:]
    return any(w in _NEGATORS for w in words) or (t.startswith("entrap", start) and "any" in words)


def _first_real(pat: re.Pattern, t: str, medical: bool = False):
    return next((m for m in pat.finditer(t) if medical or not _negated(t, m.start())), None)


_MPDS = re.compile(r"\b(\d{1,2})?\s*-?\s*(alpha|bravo|charlie|delta|echo|omega)\b")
_PRIORITY = re.compile(r"\b(?:priority|priorit\w*|predi|parity|priorty|priory)\s+(\d)\b")
_ACUITY = {"omega": 0, "alpha": 1, "bravo": 2, "charlie": 3, "delta": 4, "echo": 5}


def classify(t: str, anchor: int | None = None) -> tuple[str, int]:
    """Classify the call's nature.

    Without an anchor, the first matching pattern (priority order) wins. With
    an anchor (the position of the extracted address), prefer the nature
    mentioned closest before it — one transmission can carry two dispatches
    ("carbon monoxide at <address> ... take the jumper call").
    """
    if anchor is None:
        for cat, sev, pat in _NATURES:
            if _first_real(pat, t, cat == "medical"):
                return cat, sev
        return "other", 1
    matches = [(m.start(), m.end(), order, cat, sev)
               for order, (cat, sev, pat) in enumerate(_NATURES) for m in pat.finditer(t) if cat == "medical" or not _negated(t, m.start())]
    # Drop matches nested inside a longer one ("fire" inside "structure fire").
    matches = [a for a in matches
               if not any(b is not a and b[0] <= a[0] and a[1] <= b[1] and (b[1] - b[0]) > (a[1] - a[0])
                          for b in matches)]
    before = [m for m in matches if m[0] <= anchor]
    if before:
        # Nearest before the address; ties go to the more specific (earlier-listed) pattern.
        # "traffic accident with injuries at ..." is a crash: the vague medical word nearest the address does not win
        # over a real incident nature within a clause of it.
        near = [m for m in before if m[3] != "medical" and anchor - m[0] <= 90]
        _, _, _, cat, sev = min(near or before, key=lambda m: (anchor - m[0], m[2]))
        return cat, sev
    return classify(t)


# ── Locations ────────────────────────────────────────────────────────────────

_DIR = {
    "north": "N", "south": "S", "east": "E", "west": "W", "northeast": "NE", "northwest": "NW",
    "southeast": "SE", "southwest": "SW", "n": "N", "s": "S", "e": "E", "w": "W",
    "ne": "NE", "nw": "NW", "se": "SE", "sw": "SW", "north east": "NE", "north west": "NW",
    "south east": "SE", "south west": "SW",
}
_SUFFIX = {
    "street": "St", "st": "St", "avenue": "Ave", "ave": "Ave", "boulevard": "Blvd", "blvd": "Blvd",
    "road": "Rd", "rd": "Rd", "drive": "Dr", "dr": "Dr", "way": "Way", "highway": "Hwy", "hwy": "Hwy",
    "parkway": "Pkwy", "court": "Ct", "ct": "Ct", "place": "Pl", "lane": "Ln", "ln": "Ln",
    "terrace": "Ter", "circle": "Cir", "loop": "Loop", "freeway": "Fwy", "cutoff": "Cutoff",
}
_DIR_RE = r"(?:north ?east|north ?west|south ?east|south ?west|northeast|northwest|southeast|southwest|north|south|east|west|ne|nw|se|sw)"
_SUFFIX_RE = "|".join(sorted(_SUFFIX, key=len, reverse=True))
# A street: optional direction, then either one numbered token ("70th", "2")
# or 1-3 word tokens that are not directions, then a suffix.
# Words that are never part of a street name: "217 northbound and highway 99", "on their way", "we're at ...".
_NOT_NAME = r"northbound|southbound|eastbound|westbound|we|re|their|his|her|our|my|your|its|this|that|these|those|side|same"
_WORD = rf"(?!(?:{_DIR_RE}|{_NOT_NAME})\b)[a-z][a-z0-9']*"
_NAME = rf"(?:\d{{1,3}}(?:st|nd|rd|th)?|martin luther king(?: jr)?|{_WORD}(?:\s+{_WORD}){{0,2}}?)"


def _street_re(i: int) -> str:
    # Clackamas County reads the direction after the street ("Hubbard Cutoff Northeast"); it only counts there when
    # what follows ends the street ("... and ...", cross streets, a unit, the end), so it never steals the next
    # street's own direction.
    return (rf"(?:(?P<d{i}>{_DIR_RE})\s+)?(?P<n{i}>{_NAME})\s+(?P<s{i}>{_SUFFIX_RE})\b"
            rf"(?:\s+(?P<t{i}>{_DIR_RE})\b(?=\s+(?:and|at)\b|\s*&|\s+cross\b|\s+unit\b|\s+working\b|\s*$))?")


def _dir(m: re.Match, i: int) -> str | None:
    """The direction of street i: the leading one if heard, else the trailing one."""
    g = m.groupdict()
    return g.get(f"d{i}") or g.get(f"t{i}")


_ADDR_RE = re.compile(r"\b(?P<num>\d{2,6})\s+(?:(?:of\s+(?:the\s+)?|this\s+is\s+|that\s+was\s+|that\s+is\s+))?" + _street_re(1))
# "X and Y", "X & Y", "X at Y", or two streets read back-to-back (commas are
# stripped by normalise) — the latter only when both carry a direction.
_INTERSECTION_RE = re.compile(r"\b" + _street_re(1) + r"\s+(?:and\s+|&\s+|at\s+)?" + _street_re(2))
# Portland streets like "N Broadway" carry no suffix: allow a suffix-less
# second street when it has an explicit direction.
_INTERSECTION_BARE_RE = re.compile(
    r"\b" + _street_re(1) + r"\s+(?:and\s+|&\s+|at\s+)?(?P<d2>" + _DIR_RE + r")\s+(?P<n2>" + _WORD + r")\b(?!\s+(?:" + _SUFFIX_RE + r")\b)"
)
# Dispatch often reads a street without its suffix ("11879 southwest austin", "2020 southwest broadway behind ...").
# Only trusted as a last resort and only with a direction, a 3+ digit number and a dispatch cue after the name.
_ADDR_BARE_RE = re.compile(
    r"\b(?P<num>\d{3,6})\s+(?P<d1>" + _DIR_RE + r")\s+(?P<n1>(?!(?:" + _SUFFIX_RE + r")\b)" + _WORD + r"(?:\s+" + _WORD + r"){0,1}?)"
    r"(?=\s+(?:cross streets?|unit\b|ops?\b|working|talk ?group|respon\w*|please|tucker\w*|switch|stand ?by|behind|next to|near|across|in the|apartments?)|\s*$)")
# Portland shorthand "southeast 202 in burnside" = SE 202nd & Burnside.
_NUM_IN_RE = re.compile(r"\b(?P<d1>" + _DIR_RE + r")\s+(?P<n1>\d{1,3})\s+(?:in|and|at)\s+(?:(?P<d2>" + _DIR_RE + r")\s+)?(?P<n2>" + _WORD + r")\b")
# "at Cruzway and Bangui Road": the first street was heard without its suffix.
_AT_BARE_AND_RE = re.compile(r"\bat\s+(?P<n1>" + _WORD + r")\s+and\s+" + _street_re(2))
# "off of Northwest Dairy Creek Road", "on Corey Road": a street without a house number, trusted only after a place word.
_STREET_ONLY_RE = re.compile(r"\b(?:on|off(?: of)?|along|near)\s+(?:the\s+)?" + _street_re(1))
_LANDMARK_RE = re.compile(r"\b(?:on|at|off) (?:the )?(?:(\w+) )?(bridge|overpass|river|waterfront|max (?:platform|station)|transit (?:center|station)|light rail)\b")
_HIGHWAY_RE = re.compile(r"\b(?:i|interstate)\s*-?\s*(5|84|205|405)\b|\b(?:east|west|north|south)bound\s+(?:i\s*-?\s*)?(?P<bd>5|84|205|405)\b|\b(?:highway|hwy|us|or)\s*-?\s*(26|30|217|99e|99w|43|213|224|8|10)\b|\bsunset highway\b")
_NOT_STREET = {"alpha", "bravo", "charlie", "delta", "echo", "omega", "ops", "op", "unit", "priority", "code", "engine", "medic", "truck"}
_STOP_NAME = re.compile(r"^(on|at|in|to|the|and|of|a|respond|responding|unit|ops|is|for|with)\b")


# Words an ASR'd sentence puts in front of a street name ("injuries at Ellen Road", "cross streets are Leonard Street").
_LEAD_WORDS = frozenset({"streets", "street", "cross", "ross", "are", "is", "and", "at", "on", "in", "to", "of", "by", "for", "near",
                         "off", "the", "a", "an", "respond", "responding", "response", "injuries", "injury", "accident",
                         "accidents", "crash", "unit", "working", "channel", "ops", "no", "from", "with", "address", "medical", "code", "alarm"})


def _street(d: str | None, name: str, suffix: str, lead: bool = False) -> str | None:
    """Display form of a street. `lead=True` also drops sentence words glued to the front of a name (for cross streets and
    intersections, where nothing else anchors the match); an address's own street is never trimmed, so "122 responding
    river road" is not read as an address."""
    words = name.strip().split()
    while lead and len(words) > 1 and words[0] in _LEAD_WORDS:
        words.pop(0)
    name = " ".join(words)
    hwy = next((h for h in (re.fullmatch(r"hwy(\d{1,3}[a-z]?)", w) for w in reversed(words)) if h), None)
    if hwy:     # "Southeast Highway 212" arrives here as name "hwy212" (see locate), possibly after a garbled word
        return " ".join(p for p in (_DIR.get(re.sub(r"\s+", " ", d or "").strip(), "") if d else "", f"Hwy {hwy.group(1).upper()}") if p)
    if _STOP_NAME.match(name) or (len(name) < 2 and not name.isdigit()):
        return None
    # "70" + "Avenue" -> "70th"
    if re.fullmatch(r"\d+", name) and suffix:
        n = int(name)
        name = f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"
    pretty = " ".join(w if re.match(r"\d", w) else w.capitalize() for w in name.split())
    parts = [_DIR.get(re.sub(r"\s+", " ", d or "").strip(), "") if d else "", pretty, _SUFFIX.get(suffix, "")]
    return " ".join(p for p in parts if p)


def _address_key(num: str, d: str | None, name: str) -> str:
    """Cluster key tolerant of ASR spelling drift: number + direction + name stem."""
    word = re.sub(r"[^a-z0-9]", "", name.lower())
    # Consonant skeleton survives ASR vowel drift ("wigan" / "wygant" -> "wgn").
    stem = (word[:1] + re.sub(r"[aeiouy]", "", word[1:]))[:3] if word and not word[0].isdigit() else word[:4]
    return f"{num}|{_DIR.get(re.sub(r'\s+', ' ', d or '').strip(), '')}|{stem}"


def extract_location(t: str) -> tuple[str | None, str | None]:
    """Return (display_location, cluster_key) from normalised text."""
    loc, key, _ = locate(t)
    return loc, key


_SPLIT_NUM_RE = re.compile(r"\b(\d{2,4})-(\d{1,2})(?=\s+" + _DIR_RE + r"\b)")


def locate(t: str) -> tuple[str | None, str | None, int | None]:
    """Return (display_location, cluster_key, match_position) from normalised text."""
    t = _SPLIT_NUM_RE.sub(lambda m: m.group(1) + m.group(2), t)   # same length or shorter; position is only a hint
    raw = t
    # "southeast highway 212 and southeast 135th avenue": read a numbered highway as a street named hwy212.
    t = re.sub(r"\b(?:highway|hwy)\s+(\d{1,3}[a-z]?)\b", r"hwy\1 hwy", t)
    m = _ADDR_RE.search(t)
    if m:
        street = _street(_dir(m, 1), m.group("n1"), m.group("s1"))
        if street:
            return f"{m.group('num')} {street}", _address_key(m.group("num"), _dir(m, 1), m.group("n1")), m.start()
    for m in _INTERSECTION_RE.finditer(t):
        between = t[m.end("s1"):m.start("n2")]
        if not re.search(r"\b(and|&|at)\b", between) and not (_dir(m, 1) and _dir(m, 2)):
            continue
        a = _street(_dir(m, 1), m.group("n1"), m.group("s1"), True)
        b = _street(_dir(m, 2), m.group("n2"), m.group("s2"), True)
        if a and b and a != b:
            return f"{a} & {b}", " & ".join(sorted([a.lower(), b.lower()])), m.start()
    m = _INTERSECTION_BARE_RE.search(t)
    if m:
        a = _street(_dir(m, 1), m.group("n1"), m.group("s1"), True)
        b = _street(_dir(m, 2), m.group("n2"), "", True)
        if a and b and a != b:
            return f"{a} & {b}", " & ".join(sorted([a.lower(), b.lower()])), m.start()
    m = _NUM_IN_RE.search(t)
    if m:
        a = _street(_dir(m, 1), m.group("n1"), "ave")
        b = _street(_dir(m, 2), m.group("n2"), "")
        if a and b and not _STOP_NAME.match(m.group("n2")) and m.group("n2") not in _NOT_STREET:
            return f"{a} & {b}", " & ".join(sorted([a.lower(), b.lower()])), m.start()
    m = _ADDR_BARE_RE.search(t)
    if m:
        street = _street(_dir(m, 1), m.group("n1"), "")
        if street:
            return f"{m.group('num')} {street}", _address_key(m.group("num"), _dir(m, 1), m.group("n1")), m.start()
    m = _AT_BARE_AND_RE.search(t)
    if m:
        a = _street(None, m.group("n1"), "", True)
        b = _street(_dir(m, 2), m.group("n2"), m.group("s2"), True)
        if a and b and a != b and m.group("n1") not in _NOT_STREET:
            return f"{a} & {b}", " & ".join(sorted([a.lower(), b.lower()])), m.start()
    t = raw
    m = _LANDMARK_RE.search(t)
    if m:
        name = f"{m.group(1)} {m.group(2)}" if m.group(1) and m.group(1) not in ("the", "a") else m.group(2)
        return f"{name} (landmark)", None, m.start()
    m = _HIGHWAY_RE.search(t)
    if m:
        if m.group(1) or m.group("bd"):
            hw = f"I-{m.group(1) or m.group('bd')}"
        elif m.group(3):
            hw = f"Hwy {m.group(3).upper()}"
        else:
            hw = "US 26 (Sunset Hwy)"
        return hw, None, m.start()  # highways are too long to cluster on alone
    m = _STREET_ONLY_RE.search(t)
    if m:
        street = _street(_dir(m, 1), m.group("n1"), m.group("s1"), True)
        if street and m.group("n1") not in _NOT_STREET:
            # A street with no number: fine to show and to cluster on a street + direction + name stem within a call's gap.
            return street, f"street|{_DIR.get(_dir(m, 1) or '', '')}|{_address_key('0', None, m.group('n1')).split('|')[2]}", m.start()
    return None, None, None


# ── Units / status ───────────────────────────────────────────────────────────

# Longer names first ("heavy rescue" before "rescue"). AMR is the private
# ambulance contractor; in the transcripts its units outnumber medics 4:1.
_UNIT_RE = re.compile(r"\b(heavy rescue|water tender|duty officer|battalion chief|engine|truck|medic|amr|squad|rescue|"
                      r"fireboat|brush(?: unit)?|battalion|tender|ladder|quint|tower|chief|command)\s+(\d{1,4})\b")
# What each unit is, for "3 engines, a truck, 2 ambulances" (most significant first).
_UNIT_TYPES: list[tuple[str, tuple[str, ...], str]] = [
    ("engine", ("engine",), "engines"),
    ("truck", ("truck", "ladder", "quint", "tower"), "trucks"),
    ("heavy rescue", ("heavy rescue",), "heavy rescues"),
    ("rescue", ("rescue",), "rescues"),
    ("squad", ("squad",), "squads"),
    ("tender", ("tender", "water tender"), "tenders"),
    ("brush unit", ("brush", "brush unit"), "brush units"),
    ("fireboat", ("fireboat",), "fireboats"),
    ("ambulance", ("medic", "amr"), "ambulances"),
    ("chief officer", ("battalion", "battalion chief", "chief", "command", "duty officer"), "chief officers"),
]
_KIND_TYPE = {k: (single, plural) for single, kinds, plural in _UNIT_TYPES for k in kinds}
_UNIT_ORDER = [t[0] for t in _UNIT_TYPES]

# "cross streets are southwest bruce drive and southwest princess avenue"
_CROSS_RE = re.compile(r"\bcross streets? (?:are|is) " + _street_re(1) + r"\s+(?:and|&)\s+" + _street_re(2))
# "respond to commercial fire" — the kind of structure, when stated.
_NATURE_ADJ = re.compile(r"\b(commercial|residential|apartment|house|garage|shed|barn|mobile home|chimney|kitchen|attic|basement) fire\b")
# What dispatch says that escalates (or settles) a call. Mined from a day of
# WCN/CCOM dispatch audio: alarm levels and "knocked down" are fireground
# talk and never reach the dispatch channels we record.
_MARKERS: list[tuple[str, re.Pattern]] = [
    ("Entrapment", re.compile(r"\bentrap\w*|\b(people|persons?|occupants?|patients?) (are )?trapped\b")),
    ("CPR in progress", re.compile(r"\bcpr\b")),
    ("Multiple patients", re.compile(r"\b([2-9]|\d{2}) patients\b|\bmultiple patients\b")),
    ("Evacuation", re.compile(r"\bevacuat\w*")),
    ("Exposures threatened", re.compile(r"\bexposures?\b")),
    ("Power lines down", re.compile(r"\b(power ?lines?|wires?) down\b")),
    ("Task force", re.compile(r"\btask force\b")),
    ("More resources requested", re.compile(r"\b(additional|more) (resources|units|engines?|trucks?|companies)\b")),
    ("Fire marshal", re.compile(r"\bfire marshal\b")),
    ("Nothing showing", re.compile(r"\bnothing showing\b")),
]
_STATUS = [
    ("cleared", re.compile(r"\b(recall(ing|ed)?|clear(ing|ed)? (the )?(scene|off)|cancel(led)?|return(ing)? (to )?(quarters|service))\b")),
    ("contained", re.compile(r"\b(fire is out|knock ?down|extinguished|under control|contained)\b")),
    ("on_scene", re.compile(r"\bon (the )?scene\b")),
]


def _unit_name(kind: str) -> str:
    kind = re.sub(r"\s+unit$", "", kind)
    return "AMR" if kind == "amr" else kind.title()


def units_in(t: str) -> list[str]:
    seen: list[str] = []
    for kind, num in _UNIT_RE.findall(t):
        u = f"{_unit_name(kind)} {num}"
        if u not in seen:
            seen.append(u)
    return seen


def unit_summary(units: list[str]) -> str | None:
    """["Engine 309", "Engine 317", "Heavy Rescue 305", "AMR 12"] -> "2 engines, a heavy rescue, an ambulance"."""
    counts: dict[str, int] = {}
    for u in units:
        kind = u.rsplit(" ", 1)[0].lower()
        single = _KIND_TYPE.get(kind, (kind, kind + "s"))[0]
        counts[single] = counts.get(single, 0) + 1
    if not counts:
        return None
    parts = []
    for single in sorted(counts, key=lambda k: _UNIT_ORDER.index(k) if k in _UNIT_ORDER else 99):
        n = counts[single]
        plural = next((p for s_, _, p in _UNIT_TYPES if s_ == single), single + "s")
        parts.append(f"{n} {plural}" if n > 1 else f"{'an' if single[0] in 'aeiou' else 'a'} {single}")
    return ", ".join(parts)


def cross_streets_in(t: str) -> str | None:
    m = _CROSS_RE.search(t)
    if not m:
        return None
    a = _street(m.group("d1"), m.group("n1"), m.group("s1"))
    b = _street(m.group("d2"), m.group("n2"), m.group("s2"))
    return f"{a} & {b}" if a and b and a != b else None


def markers_in(t: str) -> list[str]:
    return [label for label, pat in _MARKERS if pat.search(t)]


def status_of(t: str) -> str | None:
    for status, pat in _STATUS:
        if pat.search(t):
            return status
    return None


# ── Calls and clustering ─────────────────────────────────────────────────────

@dataclass
class Call:
    ts: datetime
    tgid: int | None
    tag: str
    text: str
    category: str
    severity: int
    location: str | None
    key: str | None
    units: list[str]
    status: str | None
    acuity: str | None
    priority: int | None
    cross_streets: str | None = None
    nature: str | None = None
    markers: list[str] = field(default_factory=list)


def parse_call(ts: datetime, tgid, tag: str, text: str) -> Call:
    t = normalise(text)
    loc, key, pos = locate(t)
    cat, sev = classify(t, pos)
    if key and key.startswith("street|") and sev < 3:
        loc = key = None     # a bare street name is only worth an incident for a serious call ("en route to Kelsey Road" is not)
    if cat == "critical_medical" and not key:
        cat, sev = "medical", 1     # without an address it is dispatcher chatter ("put the truck on the choking call"), not a call
    mp = _MPDS.search(t)
    acuity = mp.group(2) if mp else None
    pr = _PRIORITY.search(t)
    # High-acuity medical calls (Delta/Echo) are more than routine EMS.
    if cat == "medical" and acuity in ("delta", "echo"):
        sev = 2
    na = _NATURE_ADJ.search(t) if cat in ("structure_fire", "fire") else None
    return Call(ts=ts, tgid=tgid, tag=tag or "", text=text, category=cat, severity=sev, location=loc, key=key,
                units=units_in(t), status=status_of(t), acuity=acuity, priority=int(pr.group(1)) if pr else None,
                cross_streets=cross_streets_in(t), nature=f"{na.group(1).capitalize()} fire" if na else None,
                markers=markers_in(t))


@dataclass
class Incident:
    category: str
    severity: int
    location: str | None
    key: str | None
    first_seen: datetime
    last_seen: datetime
    calls: list[Call] = field(default_factory=list)
    units: list[str] = field(default_factory=list)
    status: str = "active"
    acuity: str | None = None
    talkgroups: list[str] = field(default_factory=list)
    lat: float | None = None
    lon: float | None = None
    geofences: list[str] = field(default_factory=list)
    city: str | None = None
    cross_streets: str | None = None
    nature: str | None = None
    markers: list[str] = field(default_factory=list)
    # Real street name when the one heard on the radio was ASR-garbled.
    location_corrected: str | None = None

    @property
    def summary_quote(self) -> str:
        # The longest transmission usually carries the full dispatch read-out.
        best = max(self.calls, key=lambda c: (c.severity, len(c.text)))
        return best.text

    def to_dict(self) -> dict:
        return {
            "id": f"{self.first_seen.strftime('%Y%m%d%H%M')}-"
                  + re.sub(r"[^a-z0-9]+", "-", (self.key or self.location or self.category).lower()).strip("-")[:40],
            "category": self.category,
            "severity": self.severity,
            "location": self.location_corrected or self.location,
            "location_heard": self.location if self.location_corrected else None,
            "first_seen": self.first_seen.isoformat(),
            "last_seen": self.last_seen.isoformat(),
            "call_count": len(self.calls),
            "units": self.units,
            "status": self.status,
            "acuity": self.acuity,
            "talkgroups": self.talkgroups,
            "quote": self.summary_quote[:400],
            "lat": self.lat,
            "lon": self.lon,
            "geofences": self.geofences,
            "city": self.city,
            "cross_streets": self.cross_streets,
            "nature": self.nature,
            "unit_summary": unit_summary(self.units),
            "markers": self.markers,
        }


_STATUS_RANK = {"active": 0, "on_scene": 1, "contained": 2, "cleared": 3}


_FAMILY = {"structure_fire": "fire", "fire": "fire", "outside_fire": "fire", "vehicle_fire": "fire", "fire_alarm": "fire",
           "gas_leak": "gas", "carbon_monoxide": "gas", "hazmat": "gas"}


def _compatible(a: str, b: str) -> bool:
    """Could two calls about the same place be the same incident? Anything pairs with the vague "other"; otherwise the
    categories must be in one family (all fire types, all gas types) or be the same."""
    if "other" in (a, b) or a == b:
        return True
    fa, fb = _FAMILY.get(a), _FAMILY.get(b)
    return fa is not None and fa == fb


def _number_dir(key: str | None) -> tuple[str, str] | None:
    """House number + direction of an address key ("1485|NE|gardner"): the part ASR rarely garbles."""
    parts = (key or "").split("|")
    return (parts[0], parts[1]) if len(parts) == 3 and parts[0].isdigit() and len(parts[0]) >= 3 else None


def _unit_keys(units: list[str]) -> set[str]:
    return {u.lower() for u in units}


def _absorb(into: "Incident", c: Call) -> None:
    into.calls.append(c)
    into.last_seen = max(into.last_seen, c.ts)
    into.first_seen = min(into.first_seen, c.ts)
    if c.severity > into.severity and _compatible(c.category, into.category):
        into.category, into.severity = c.category, c.severity
    if c.acuity and (into.acuity is None or _ACUITY.get(c.acuity, 0) > _ACUITY.get(into.acuity, 0)):
        into.acuity = c.acuity
    for u in c.units:
        if u not in into.units:
            into.units.append(u)
    if c.tag and c.tag not in into.talkgroups:
        into.talkgroups.append(c.tag)
    into.cross_streets = into.cross_streets or c.cross_streets
    into.nature = into.nature or c.nature
    for m in c.markers:
        if m not in into.markers:
            into.markers.append(m)
    if c.status and _STATUS_RANK[c.status] > _STATUS_RANK[into.status]:
        into.status = c.status


def cluster(calls: list[Call], gap: timedelta = timedelta(minutes=90)) -> list[Incident]:
    """Group calls about the same place into incidents.

    1. Same address key within `gap` (status-only follow-ups with an address merge too).
    2. The same house number + direction under a different street name within `gap` is the same incident whose street
       name ASR spelled two ways ("Blooms Ferry" / "Boonesbury"), provided the categories are compatible.
    3. Calls without an address cannot cluster on one, so they are linked by units: a call whose units match exactly
       one nearby incident joins it (this is how "Engine 62 clear" or "recall" closes an incident, and how a truncated
       dispatch read joins the incident that has the full address). Ambiguous matches are left alone.
    4. A serious address-less call of a nature in _NEARBY_LINKABLE heard within three minutes of exactly one incident of the
       same nature joins it (the dispatch read twice, once without the address).
    Routine unlocated chatter that links to nothing is dropped.
    """
    incidents: list[Incident] = []
    open_by_key: dict[str, Incident] = {}
    open_by_nd: dict[tuple[str, str], Incident] = {}
    loose: list[Call] = []          # address-less calls that did not start an incident, for the unit-linking pass
    for c in sorted(calls, key=lambda c: c.ts):
        inc = open_by_key.get(c.key) if c.key else None
        if inc is not None and c.ts - inc.last_seen > gap:
            inc = None
        nd = _number_dir(c.key)
        if inc is None and nd is not None:
            cand = open_by_nd.get(nd)
            if cand is not None and c.ts - cand.last_seen <= gap and _compatible(c.category, cand.category):
                inc = cand
                open_by_key[c.key] = cand
        if inc is None:
            if not c.key and c.severity < 3:
                if c.units and c.status:
                    loose.append(c)
                continue
            if c.category == "other" and not c.units:
                continue
            inc = Incident(category=c.category, severity=c.severity, location=c.location, key=c.key,
                           first_seen=c.ts, last_seen=c.ts)
            incidents.append(inc)
            if c.key:
                open_by_key[c.key] = inc
                if nd is not None:
                    open_by_nd[nd] = inc
        inc.calls.append(c)
        inc.last_seen = max(inc.last_seen, c.ts)
        if c.severity > inc.severity or inc.category in ("other", "fire_alarm") and c.category not in ("other",):
            if c.severity >= inc.severity:
                inc.category, inc.severity = c.category, c.severity
        if c.acuity and (inc.acuity is None or _ACUITY.get(c.acuity, 0) > _ACUITY.get(inc.acuity, 0)):
            inc.acuity = c.acuity
        for u in c.units:
            if u not in inc.units:
                inc.units.append(u)
        if c.tag and c.tag not in inc.talkgroups:
            inc.talkgroups.append(c.tag)
        inc.cross_streets = inc.cross_streets or c.cross_streets
        inc.nature = inc.nature or c.nature
        for m in c.markers:
            if m not in inc.markers:
                inc.markers.append(m)
        if c.status and _STATUS_RANK[c.status] > _STATUS_RANK[inc.status]:
            inc.status = c.status
    return _link_by_units(incidents, loose)


_LINK_BEFORE = timedelta(minutes=10)     # a follow-up may be heard slightly before the dispatch read that carries the address
_LINK_AFTER = timedelta(hours=3)         # status traffic can trail the last address read by hours on a big incident
_LINK_AFTER_SERIOUS = timedelta(minutes=45)
# Natures where two separate incidents of the same kind within a few minutes are rare enough that an address-less call
# heard that close to exactly one addressed incident is almost always another read of it. Assaults, violence, rescues and
# medical calls are excluded: those do overlap, and their chatter is often about something else.
_NEARBY_LINKABLE = {"structure_fire", "fire", "outside_fire", "vehicle_fire", "gas_leak", "carbon_monoxide", "hazmat", "crash", "water_rescue"}
_LINK_NEARBY = timedelta(minutes=3)


def _link_by_units(incidents: list[Incident], loose: list[Call]) -> list[Incident]:
    located = [i for i in incidents if i.key]
    unlocated = [i for i in incidents if not i.key]

    def candidates(units: set[str], t0, t1, category: str | None, after: timedelta) -> list[Incident]:
        return [i for i in located
                if units & _unit_keys(i.units) and i.first_seen - _LINK_BEFORE <= t0 and t1 <= i.last_seen + after
                and (category is None or _compatible(category, i.category))]

    for call in loose:                                   # "Engine 62 clear", "recall", "on scene" with no address
        found = candidates(_unit_keys(call.units), call.ts, call.ts, None, _LINK_AFTER)
        if len(found) == 1:
            _absorb(found[0], call)
    absorbed: set[int] = set()
    for u in unlocated:                                  # serious address-less calls (truncated reads, field traffic)
        if not u.units:
            continue
        found = candidates(_unit_keys(u.units), u.first_seen, u.last_seen, u.category, _LINK_AFTER_SERIOUS)
        if len(found) == 1:
            for c in u.calls:
                _absorb(found[0], c)
            absorbed.add(id(u))
    for u in unlocated:                                  # a dispatch read without its address, heard with the addressed one
        if id(u) in absorbed or u.category not in _NEARBY_LINKABLE:
            continue
        near = [i for i in located if i.category == u.category and abs(i.first_seen - u.first_seen) <= _LINK_NEARBY]
        if len(near) == 1:
            for c in u.calls:
                _absorb(near[0], c)
            absorbed.add(id(u))
    return [i for i in incidents if id(i) not in absorbed]


def rank(incidents: list[Incident]) -> list[Incident]:
    """Most significant first: severity, then multi-unit/multi-call, then recency."""
    return sorted(incidents, key=lambda i: (i.severity, len(i.units) + len(i.calls), i.last_seen), reverse=True)


_HOSPITAL_TAG = re.compile(r"\bhosp(?:ital)?\b|\bhos\b|\bhsp\b|medical (?:center|ctr)|\bmed ctr\b|\bemergency room\b", re.I)


def is_hospital_tag(tag: str | None, extra: tuple[str, ...] | list[str] = ()) -> bool:
    """True for talkgroups that carry EMS-to-hospital patient reports ("code 1 with a 74-year-old female ... ETA 10").

    Those describe a patient the dispatch channels already handled, with histories full of "collapsed", "shot",
    "stabbing pain" and "motor vehicle accident", so they are not incidents of their own. The transcripts stay in
    the database (they are a source of aggregate EMS-load signals); they just don't create or merge incidents.
    `extra` adds site-specific tag substrings for names without a hospital marker.
    """
    tag = tag or ""
    return bool(_HOSPITAL_TAG.search(tag)) or any(e and e.lower() in tag.lower() for e in extra)


def extract(rows, hospital_tags: tuple[str, ...] | list[str] = ()) -> list[Incident]:
    """rows: iterable of (ts, tgid, tag, transcription). Returns ranked incidents."""
    calls = [parse_call(ts, tgid, tag or "", text or "") for ts, tgid, tag, text in rows
             if text and len(text) >= 20 and not is_hospital_tag(tag, hospital_tags)]
    return rank(cluster(calls))
