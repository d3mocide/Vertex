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
    t = _NUM_RUN.sub(lambda m: " " + _words_to_digits(m.group(0)) + " ", t)
    for word, ordinal in _ORDINALS.items():
        t = re.sub(rf"\b{word}\b", ordinal, t)
    t = re.sub(r"\b(\d+)\s+(st|nd|rd|th)\b", r"\1\2", t)
    t = re.sub(r"[^\w\s/&-]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# ── Nature / severity ────────────────────────────────────────────────────────

# (category, severity 1-5, pattern) — first match wins, so order matters.
_NATURES: list[tuple[str, int, re.Pattern]] = [
    ("water_rescue", 5, re.compile(r"water rescue|in the water|person in (the )?water|jumper|on the railing|fireboat|swift ?water")),
    # "(?! alarm)": "commercial fire alarm" is an alarm, not a fire.
    ("structure_fire", 5, re.compile(r"(?:structure|house|apartment|residential|commercial|working) fire(?! alarm)|fire in (a|the) (building|house|apartment|unit)|smoke (in|from) (the |a )?(building|house|apartment|residence)")),
    ("violence", 4, re.compile(r"shooting|shots fired|gunshot|stabbing|stabbed|\bshot\b")),
    ("rescue", 4, re.compile(r"entrap|trapped|high angle|confined space|technical rescue|extrication|collapse")),
    ("hazmat", 4, re.compile(r"hazmat|hazardous material|fuel spill|chemical (spill|leak)")),
    ("gas_leak", 4, re.compile(r"gas (leak|odor|smell)|odor of gas|smell of gas|natural gas|gas line")),
    ("carbon_monoxide", 4, re.compile(r"carbon mon\w*|\bco alarm")),
    ("train_or_ped_struck", 4, re.compile(r"(pedestrian|person) struck|struck by (a |an )?(car|vehicle|train|freight)|train vs|versus (a )?train")),
    ("crash", 3, re.compile(r"traffic accident|motor vehicle (accident|crash|collision)|\bmvc\b|\bmva\b|rollover|collision|crash")),
    ("vehicle_fire", 3, re.compile(r"(car|vehicle|auto|truck|rv) fire")),
    ("outside_fire", 3, re.compile(r"vegetation|brush fire|grass fire|tree (is )?on fire|bark ?dust|outside fire|dumpster fire|trash fire|debris fire|cardboard|smoke investigation|illegal burn|fire on the")),
    ("assault", 3, re.compile(r"assault")),
    ("fire_alarm", 1, re.compile(r"fire alarm|commercial alarm|unverified alarm|smoke alarm|alarm activation")),
    # A bare "fire" (after alarms are ruled out) is nearly always a real one;
    # ASR often mangles the qualifier ("smallside fire" = small outside fire).
    ("fire", 3, re.compile(r"\bfire\b(?! (department|dispatch|station|engine|district|marshal|boat|ops|crews?))")),
    ("medical", 1, re.compile(r"sick person|breathing problem|\bfall\b|unconscious|chest pain|seizure|abdominal|psychiatric|overdose|diabetic|stroke|cardiac|allergic|bleeding|lift assist|medical alarm|sick|injur|pain|breathing|faint|welfare check|intoxicated")),
]
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
            if pat.search(t):
                return cat, sev
        return "other", 1
    matches = [(m.start(), m.end(), order, cat, sev)
               for order, (cat, sev, pat) in enumerate(_NATURES) for m in pat.finditer(t)]
    # Drop matches nested inside a longer one ("fire" inside "structure fire").
    matches = [a for a in matches
               if not any(b is not a and b[0] <= a[0] and a[1] <= b[1] and (b[1] - b[0]) > (a[1] - a[0])
                          for b in matches)]
    before = [m for m in matches if m[0] <= anchor]
    if before:
        # Nearest before the address; ties go to the more specific (earlier-listed) pattern.
        _, _, _, cat, sev = min(before, key=lambda m: (anchor - m[0], m[2]))
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
    "terrace": "Ter", "circle": "Cir", "loop": "Loop", "freeway": "Fwy",
}
_DIR_RE = r"(?:north ?east|north ?west|south ?east|south ?west|northeast|northwest|southeast|southwest|north|south|east|west|ne|nw|se|sw)"
_SUFFIX_RE = "|".join(sorted(_SUFFIX, key=len, reverse=True))
# A street: optional direction, then either one numbered token ("70th", "2")
# or 1-3 word tokens that are not directions, then a suffix.
_WORD = rf"(?!(?:{_DIR_RE})\b)[a-z][a-z0-9']*"
_NAME = rf"(?:\d{{1,3}}(?:st|nd|rd|th)?|{_WORD}(?:\s+{_WORD}){{0,2}}?)"


def _street_re(i: int) -> str:
    return rf"(?:(?P<d{i}>{_DIR_RE})\s+)?(?P<n{i}>{_NAME})\s+(?P<s{i}>{_SUFFIX_RE})\b"


_ADDR_RE = re.compile(r"\b(?P<num>\d{2,6})\s+" + _street_re(1))
# "X and Y", "X & Y", "X at Y", or two streets read back-to-back (commas are
# stripped by normalise) — the latter only when both carry a direction.
_INTERSECTION_RE = re.compile(r"\b" + _street_re(1) + r"\s+(?:and\s+|&\s+|at\s+)?" + _street_re(2))
# Portland streets like "N Broadway" carry no suffix: allow a suffix-less
# second street when it has an explicit direction.
_INTERSECTION_BARE_RE = re.compile(
    r"\b" + _street_re(1) + r"\s+(?:and\s+|&\s+|at\s+)?(?P<d2>" + _DIR_RE + r")\s+(?P<n2>" + _WORD + r")\b(?!\s+(?:" + _SUFFIX_RE + r")\b)"
)
_LANDMARK_RE = re.compile(r"\b(?:on|at|off) (?:the )?(?:(\w+) )?(bridge|overpass|river|waterfront|max (?:platform|station)|transit (?:center|station)|light rail)\b")
_HIGHWAY_RE = re.compile(r"\b(?:i|interstate)\s*-?\s*(5|84|205|405)\b|\b(?:highway|hwy|us|or)\s*-?\s*(26|30|217|99e|99w|43|213|224|8|10)\b|\bsunset highway\b")
_STOP_NAME = re.compile(r"^(on|at|in|to|the|and|of|a|respond|responding|unit|ops|is|for|with)\b")


def _street(d: str | None, name: str, suffix: str) -> str | None:
    name = name.strip()
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


def locate(t: str) -> tuple[str | None, str | None, int | None]:
    """Return (display_location, cluster_key, match_position) from normalised text."""
    m = _ADDR_RE.search(t)
    if m:
        street = _street(m.group("d1"), m.group("n1"), m.group("s1"))
        if street:
            return f"{m.group('num')} {street}", _address_key(m.group("num"), m.group("d1"), m.group("n1")), m.start()
    for m in _INTERSECTION_RE.finditer(t):
        between = t[m.end("s1"):m.start("n2")]
        if not re.search(r"\b(and|&|at)\b", between) and not (m.group("d1") and m.group("d2")):
            continue
        a = _street(m.group("d1"), m.group("n1"), m.group("s1"))
        b = _street(m.group("d2"), m.group("n2"), m.group("s2"))
        if a and b and a != b:
            return f"{a} & {b}", " & ".join(sorted([a.lower(), b.lower()])), m.start()
    m = _INTERSECTION_BARE_RE.search(t)
    if m:
        a = _street(m.group("d1"), m.group("n1"), m.group("s1"))
        b = _street(m.group("d2"), m.group("n2"), "")
        if a and b and a != b:
            return f"{a} & {b}", " & ".join(sorted([a.lower(), b.lower()])), m.start()
    m = _LANDMARK_RE.search(t)
    if m:
        name = f"{m.group(1)} {m.group(2)}" if m.group(1) and m.group(1) not in ("the", "a") else m.group(2)
        return f"{name} (landmark)", None, m.start()
    m = _HIGHWAY_RE.search(t)
    if m:
        if m.group(1):
            hw = f"I-{m.group(1)}"
        elif m.group(2):
            hw = f"Hwy {m.group(2).upper()}"
        else:
            hw = "US 26 (Sunset Hwy)"
        return hw, None, m.start()  # highways are too long to cluster on alone
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


def cluster(calls: list[Call], gap: timedelta = timedelta(minutes=90)) -> list[Incident]:
    """Group calls about the same address within `gap` of each other into incidents.

    Calls without a clusterable address become their own incident only when
    they are non-routine (severity >= 3); routine unlocated chatter is dropped.
    Status-only follow-ups ("recall", "on scene") with an address merge into
    the open incident at that address.
    """
    incidents: list[Incident] = []
    open_by_key: dict[str, Incident] = {}
    for c in sorted(calls, key=lambda c: c.ts):
        inc = open_by_key.get(c.key) if c.key else None
        if inc is not None and c.ts - inc.last_seen > gap:
            inc = None
        if inc is None:
            if not c.key and c.severity < 3:
                continue
            if c.category == "other" and not c.units:
                continue
            inc = Incident(category=c.category, severity=c.severity, location=c.location, key=c.key,
                           first_seen=c.ts, last_seen=c.ts)
            incidents.append(inc)
            if c.key:
                open_by_key[c.key] = inc
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
    return incidents


def rank(incidents: list[Incident]) -> list[Incident]:
    """Most significant first: severity, then multi-unit/multi-call, then recency."""
    return sorted(incidents, key=lambda i: (i.severity, len(i.units) + len(i.calls), i.last_seen), reverse=True)


def extract(rows) -> list[Incident]:
    """rows: iterable of (ts, tgid, tag, transcription). Returns ranked incidents."""
    calls = [parse_call(ts, tgid, tag or "", text or "") for ts, tgid, tag, text in rows if text and len(text) >= 20]
    return rank(cluster(calls))
