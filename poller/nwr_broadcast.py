"""Structured data from what a NOAA Weather Radio station says, read from Tocsin's speech-to-text.

The broadcast is a computer-voiced loop (about 12 minutes): the station ID and time, any forecaster notice (for
example a Low Water Alert), hourly observations for a fixed list of cities, zone forecasts, a buoy report, the
coastal marine forecast and, now and then, river gauge readings. Tocsin transcribes it in ~20 s chunks that
continue each other, so the chunks are stitched into one stream and parsed here with patterns, not a model: the
script is rigid and a regex is predictable, free and testable.

Speech-to-text garbles proper nouns ("Skatoos" for Scappoose, "Core Vallis" for Corvallis). Place names are
resolved against the per-office list in data/nwr_places.yml: known spellings first, then a fuzzy match. Anything
that cannot be resolved or parsed is dropped, never guessed.

Pure functions, no I/O except reading that data file.
"""
from __future__ import annotations

import difflib
import re
import datetime as _dt
from datetime import datetime, timezone
from pathlib import Path

import yaml

_DATA = Path(__file__).parent / "data" / "nwr_places.yml"
_GAP_S = 45.0            # a longer silence between chunks means the stream broke: do not parse across it
_FUZZY_CUTOFF = 0.72

SKY = (r"(?:mostly sunny|partly sunny|mostly clear|partly cloudy|mostly cloudy|haze was reported|smoke was reported|"
       r"fog was reported|clear|sunny|cloudy|overcast|haze|smoke|fog|fair|light rain|moderate rain|heavy rain|rain|"
       r"showers|drizzle|snow|mist|thunderstorm)")
_COMPASS = r"(?:north|south|east|west)(?:east|west)?|variable|calm"


# ── data ────────────────────────────────────────────────────────────────────────────────────────

_cache: dict | None = None


def load_places() -> dict:
    global _cache
    if _cache is None:
        _cache = yaml.safe_load(_DATA.read_text()) or {}
    return _cache


class Office:
    """The place and phrase tables for one forecast office; empty for an office with no entry (parsing degrades)."""

    def __init__(self, code: str | None):
        data = load_places()
        block = (data.get("offices") or {}).get((code or "").upper(), {})
        self.code = (code or "").upper()
        self.cities = [c["name"] for c in block.get("observations", [])]
        self.home = block.get("home")
        self._alias: dict[str, str] = {}
        for c in block.get("observations", []):
            for a in c.get("aliases", []) + [c["name"]]:
                self._alias[a.lower()] = c["name"]
        self.river_alias = {k.lower(): v for k, v in (block.get("rivers", {}).get("aliases") or {}).items()}
        self.gauges = []                      # (canonical name, river words, place words, extra spellings)
        self.gauge_lid: dict[str, str | None] = {}
        for g in (block.get("rivers", {}).get("gauges") or []):
            m = re.match(r"(.+?) River (?:at|near|above|below) (.+)$", g["name"])
            if m:
                self.gauges.append((g["name"], m.group(1).lower(), m.group(2).lower(), [a.lower() for a in g.get("aliases", [])]))
                self.gauge_lid[g["name"]] = g.get("lid")
        self.fixes = [(re.compile(p, re.I), r) for p, r in data.get("fixes", [])]

    def city(self, raw: str) -> str | None:
        """Canonical city for a transcribed name, or None. Tries the longest known spelling inside the text first."""
        words = re.sub(r"[^a-z' ]", " ", raw.lower()).split()
        for n in (3, 2, 1):
            for i in range(len(words) - n + 1):
                span = " ".join(words[i:i + n])
                if span in self._alias:
                    return self._alias[span]
        text = " ".join(words)
        hit = difflib.get_close_matches(text, list(self._alias), n=1, cutoff=_FUZZY_CUTOFF)
        if hit:
            return self._alias[hit[0]]
        for w in words:                                   # one word of a longer phrase may be the garbled name
            hit = difflib.get_close_matches(w, list(self._alias), n=1, cutoff=0.8)
            if hit:
                return self._alias[hit[0]]
        return None

    def fix(self, text: str) -> str:
        for pattern, repl in self.fixes:
            text = pattern.sub(repl, text)
        return re.sub(r"\s+", " ", text).strip()


# ── number words ────────────────────────────────────────────────────────────────────────────────

_ONES = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen "
                                    "fourteen fifteen sixteen seventeen eighteen nineteen".split())}
_TENS = {w: 10 * (i + 2) for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split())}
_NUMWORD = re.compile(r"\b(?:(" + "|".join(_TENS) + r")(?:[- ](" + "|".join(list(_ONES)[1:10]) + r"))?|(" + "|".join(_ONES) + r"))\b",
                      re.I)


def digitize(text: str) -> str:
    """'at six knots' -> 'at 6 knots', 'twenty five' -> '25': the script reads small numbers as words about half the
    time and the transcriber is not consistent about it."""
    def one(m: re.Match) -> str:
        if m.group(3):
            return str(_ONES[m.group(3).lower()])
        return str(_TENS[m.group(1).lower()] + (_ONES[m.group(2).lower()] if m.group(2) else 0))
    return _NUMWORD.sub(one, text)


# ── stitching ───────────────────────────────────────────────────────────────────────────────────

def _seconds(chunk: dict) -> float | None:
    if chunk.get("timestamp_ns"):
        return chunk["timestamp_ns"] / 1e9
    try:
        return datetime.fromisoformat(str(chunk["at"]).replace("Z", "+00:00")).timestamp()
    except (KeyError, ValueError):
        return None


def stitch_marked(chunks: list[dict]) -> tuple[str, list[tuple[int, float]]]:
    """Chunks (each with `text` and `timestamp_ns` or `at`) as one continuous text, oldest first, plus (character
    offset, time) marks so a position in the text can be dated. A silence longer than _GAP_S becomes a paragraph
    break so a sentence is never joined across a dropout."""
    ordered = sorted((c for c in chunks if c.get("text") and _seconds(c) is not None), key=_seconds)
    text = ""
    marks: list[tuple[int, float]] = []
    last: float | None = None
    for c in ordered:
        t = _seconds(c)
        text += ("\n" if last is not None and t - last > _GAP_S else (" " if text else "")) + ""
        marks.append((len(text), t))
        text += str(c["text"]).strip()
        last = t
    return text, marks


def stitch(chunks: list[dict]) -> str:
    return stitch_marked(chunks)[0]


def _time_at(marks: list[tuple[int, float]], index: int) -> float | None:
    when = None
    for offset, t in marks:
        if offset > index:
            break
        when = t
    return when


def _consensus(variant: str, others: list[str]) -> float:
    """How much `variant` agrees with the rest (mean similarity): the consensus wording is the least garbled one."""
    peers = [o for o in others if o is not variant]
    if not peers:
        return 1.0
    return sum(difflib.SequenceMatcher(None, variant.lower(), o.lower()).ratio() for o in peers) / len(peers)


# ── notices ─────────────────────────────────────────────────────────────────────────────────────

_TIME_SENTENCE = re.compile(r"the current time is.{0,50}?(?:daylight|standard) time\.?", re.I)
_OBS_HEADER = re.compile(r"hourly weather observations at\s*(\d{1,2})(?::\d\d)?\s*([ap])\.? ?m", re.I)
_NOTICE_MAX = 900


def notices(text: str, office: Office, marks: list[tuple[int, float]] | None = None) -> list[dict]:
    """Forecaster notices read in the broadcast intro: whatever sits between the 'current time' sentence and the
    hourly observations ("Low water alert. Expect river stages below 1 foot ..."). Each loop repeats it, slightly
    differently transcribed each time, so variants are grouped by title and the most common wording wins."""
    variants: dict[str, list[str]] = {}
    loops: dict[str, list[dict]] = {}
    for m in _TIME_SENTENCE.finditer(text):
        end = _OBS_HEADER.search(text, m.end())
        if not end or end.start() - m.end() > _NOTICE_MAX:
            continue
        body = office.fix(text[m.end():end.start()])
        if len(body) < 12:
            continue
        title = re.split(r"(?<=[.!?])\s", body, maxsplit=1)[0].rstrip(".!? ").strip()
        body = title.title() + body[len(title):]               # "Low water alert" / "Low Water Alert" are one wording
        if not title or len(title.split()) > 8:                # a title is a short phrase; otherwise it is not a notice
            continue
        variants.setdefault(title.lower(), []).append(body)
        loops.setdefault(title.lower(), []).append({"text": body, "at": _time_at(marks, m.start()) if marks else None})
    out = []
    for title, bodies in variants.items():
        # The most common wording after repairs, preferring one without a splice artifact (a chunk boundary can leave a
        # fragment like "... for the next day. the Columbia River", a lowercase word right after a period); ties go to
        # the longest, since a clipped transcription is shorter.
        best = max(set(bodies), key=lambda b: (not re.search(r"[.!?]\s+[a-z]", b), _consensus(b, bodies), len(b)))
        out.append({"id": re.sub(r"[^a-z0-9]+", "-", title).strip("-"), "title": best.split(".")[0].strip().title(),
                    "text": best, "heard": len(bodies), "loops": loops[title]})
    return out


# ── observations ────────────────────────────────────────────────────────────────────────────────

_OBS = re.compile(
    r"(?P<name>(?:[A-Za-z']+ ){0,3}?[A-Za-z']+),?\s+(?:it was\s+)?(?P<sky>" + SKY + r")\.?\s+"
    r"temperature\s+(?P<temp>\d{1,3})(?:\s+degrees)?\.?"
    r"(?:\s+wind\s+(?P<wind>calm|(?P<dir>" + _COMPASS + r")(?:\s+at\s+(?P<spd>\d{1,3}))?)(?:,?\s+gusting to\s+(?P<gust>\d{1,3}))?"
    r"(?:\s+miles an hour|\s+mph)?\.?)?"
    r"(?:\s+pressure\s+(?P<p1>\d{2})\.?\s?(?P<p2>\d)\s?(?P<p3>\d)?\s+inches(?:\s+and\s+(?P<trend>rising|falling|steady))?)?",
    re.I)
_DIRS = {"north": "N", "south": "S", "east": "E", "west": "W", "northeast": "NE", "northwest": "NW",
         "southeast": "SE", "southwest": "SW"}


def observations(text: str, office: Office) -> dict:
    """The latest block of hourly observations: {"hour": "4 PM", "stations": [...]}, or an empty block."""
    headers = list(_OBS_HEADER.finditer(text))
    if not headers:
        return {"hour": None, "stations": []}
    h = headers[-1]
    nxt = re.compile(r"forecast for|this is noaa weather radio|the current time is", re.I).search(text, h.end())
    block = text[h.end():nxt.start() if nxt else len(text)]
    stations: dict[str, dict] = {}
    for m in _OBS.finditer(block):
        city = office.city(m.group("name"))
        temp = int(m.group("temp"))
        if not city or not -40 <= temp <= 130:
            continue
        pressure = None
        if m.group("p1") and m.group("p2"):
            pressure = float(f"{m.group('p1')}.{m.group('p2')}{m.group('p3') or ''}")
            pressure = pressure if 28.0 <= pressure <= 32.0 else None
        wind = m.group("wind")
        stations[city] = {
            "place": city, "sky": m.group("sky").lower().replace(" was reported", ""), "temp_f": temp,
            "wind_dir": None if not wind or wind.lower() == "calm" else _DIRS.get(m.group("dir").lower()),
            "wind_mph": 0 if wind and wind.lower() == "calm" else (int(m.group("spd")) if m.group("spd") else None),
            "gust_mph": int(m.group("gust")) if m.group("gust") else None,
            "pressure_in": pressure, "pressure_trend": (m.group("trend") or "").lower() or None,
        }
    order = {c: i for i, c in enumerate(office.cities)}
    return {"hour": f"{int(h.group(1))} {h.group(2).upper()}M",
            "stations": sorted(stations.values(), key=lambda s: order.get(s["place"], 99))}


# ── rivers ──────────────────────────────────────────────────────────────────────────────────────

_NAME = r"[A-Z][A-Za-z.'\-]*(?: [A-Z][A-Za-z.'\-]*){0,3}"
_RIVER_ROW = re.compile(
    rf"(?P<river>{_NAME}(?: Fork)?) River (?P<prep>at|near|above|below) (?P<place>{_NAME}(?: (?:Creek|Dam|Bridge|Flume|Crossing))?)"
    rf",? (?:(?P<stage>-?\d+(?:\.\d+)?) feet(?:,? (?:with a flow of )?(?P<flow>[\d,]+)\s*(?:feet\.?\s*)?CFS)?|the report was missing)",
    re.I)
_RIVER_LIST = re.compile(rf"on the (?P<river>{_NAME}) River,? (?P<body>(?:(?:and )?at {_NAME},? -?\d+(?:\.\d+)? feet,? ?)+)"
                         r"(?:with a flow of (?P<flow>[\d,]+) ?CFS)?", re.I)
_LIST_ITEM = re.compile(rf"at (?P<place>{_NAME}),? (?P<stage>-?\d+(?:\.\d+)?) feet", re.I)


_JUNK = {"cfs", "missing", "and", "the", "on"}


def _alias(text: str, office: Office) -> str:
    """Repair transcribed place/river words: whole-phrase aliases first ('three links'), then word by word."""
    for key in sorted(office.river_alias, key=len, reverse=True):
        if " " in key:
            text = re.sub(re.escape(key), office.river_alias[key], text, flags=re.I)
    words = [office.river_alias.get(w.lower(), w) for w in text.split()]
    return " ".join(words)


def _clean_name(text: str, office: Office) -> str:
    words = text.split()
    while words and words[0].lower().strip(".,") in _JUNK:       # "CFS. Sandy" / "Missing CFS. Santiam"
        words.pop(0)
    return _alias(" ".join(w.strip(".,") for w in words), office)


_PLACE_WEIGHT = 0.6
_GAUGE_CUTOFF = 0.62
_GAUGE_MARGIN = 0.06


def _ratio(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def match_gauge(river: str, place: str, office: Office) -> tuple[str | None, float]:
    """The canonical gauge a spoken (river, place) most likely means, and how sure (0-1). None when nothing is close
    enough or two gauges are too close to call."""
    river = re.sub(r"[^a-z ]", " ", river.lower()).split()
    place = re.sub(r"[^a-z ]", " ", place.lower())
    river = " ".join(river[-2:])                                  # "Wednesday on the Willamette" -> "the willamette"
    place = " ".join(place.split()[:3])
    scored = []
    for name, g_river, g_place, extra in office.gauges:
        score = _PLACE_WEIGHT * _ratio(place, g_place) + (1 - _PLACE_WEIGHT) * _ratio(river, g_river)
        for alias in extra:
            score = max(score, _ratio(f"{river} {place}", alias))
        scored.append((score, name))
    scored.sort(reverse=True)
    if not scored or scored[0][0] < _GAUGE_CUTOFF:
        return None, scored[0][0] if scored else 0.0
    if len(scored) > 1 and scored[0][0] - scored[1][0] < _GAUGE_MARGIN:
        return None, scored[0][0]
    return scored[0][1], scored[0][0]


def rivers(text: str, office: Office) -> list[dict]:
    """River gauge readings from the hydrologic report: stage in feet, flow in CFS, or marked missing. Both phrasings
    the script uses are handled ("Clackamas River at Three Lynx, 0.3 feet, 593 CFS" and the Willamette list)."""
    best: dict[str, tuple[tuple, dict]] = {}
    text = re.sub(r"(\d+)-(\d+)(?=\s*CFS)", r"\1\2", text)           # "70-57 CFS" is 7057
    order = 0

    def add(river: str, prep: str, place: str, stage, flow, missing=False):
        nonlocal order
        river = _clean_name(river, office)
        place = _clean_name(place, office)
        river = " ".join(w[:1].upper() + w[1:] if w.islower() else w for w in river.split())
        place = " ".join(w[:1].upper() + w[1:] if w.islower() else w for w in place.split())
        if not river or not place:
            return
        order += 1
        row = {"name": f"{river} River {prep.lower()} {place}",
               "stage_ft": None if missing else float(stage),
               "flow_cfs": None if (missing or not flow) else int(flow.replace(",", "")), "missing": missing}
        if row["stage_ft"] is not None and not -10 <= row["stage_ft"] <= 120:
            return
        if office.gauges:
            name, score = match_gauge(river, place, office)
            if name is None:
                return                                              # not a gauge we know: dropped, never guessed
            row["name"], row["confidence"], row["lid"] = name, round(score, 2), office.gauge_lid.get(name)
            key = name
        else:
            key = row["name"]
        # The report repeats every loop: keep the best-matched reading of each gauge, the latest on a tie.
        rank = (row.get("confidence", 1), row["flow_cfs"] is not None, order)
        if key not in best or rank >= best[key][0]:
            best[key] = (rank, row)

    for m in _RIVER_LIST.finditer(text):
        items = list(_LIST_ITEM.finditer(m.group("body")))
        for i, it in enumerate(items):
            flow = m.group("flow") if i == len(items) - 1 else None   # the single flow figure belongs to the last gauge
            add(m.group("river"), "at", it.group("place"), it.group("stage"), flow)
    for m in _RIVER_ROW.finditer(text):
        missing = m.group("stage") is None
        add(m.group("river"), m.group("prep"), m.group("place"), m.group("stage"), m.group("flow"), missing)
    rows = [b[1] for b in best.values()]
    if office.gauges:
        position = {g[0]: i for i, g in enumerate(office.gauges)}
        rows.sort(key=lambda r: position.get(r["name"], 99))
    return rows


# ── marine ──────────────────────────────────────────────────────────────────────────────────────

_SEAS = r"(?:seas|sees|seats|feeds|seeds|c's)"           # what the transcriber makes of "seas"
_BUOY = re.compile(r"(?P<name>[A-Z][A-Za-z ]+? buoy \d+) report[,.]?\s*wind (?P<dir>(?:" + _COMPASS + r")(?: (?:" + _COMPASS + r"))?) at "
                   r"(?P<kt>\d+) knots[,.]?\s*" + _SEAS + r" (?P<ft>\d+(?:\.\d+)?) feet at (?P<s>\d+)(?: feet\.?)? seconds", re.I)
_BAR = re.compile(r"columbia river bar[^.]{0,80}?general se[a-z]*[, ]\s*(?P<lo>\d+)\s*(?:-|to)\s*(?P<hi>\d+) feet"
                  r"(?:\s+(?P<rest>through [a-z]+(?: (?:evening|night|morning|afternoon))?))?", re.I)


def marine(text: str) -> dict:
    out: dict = {}
    buoys = list(_BUOY.finditer(text))
    if buoys:
        m = buoys[-1]
        out["buoy"] = {"name": m.group("name").strip(), "wind_dir": _DIRS.get(m.group("dir").lower().split()[0]),
                       "wind_kt": int(m.group("kt")), "seas_ft": float(m.group("ft")), "period_s": int(m.group("s"))}
    bars = list(_BAR.finditer(text))
    if bars:
        m = bars[-1]
        out["bar"] = {"seas_ft": [int(m.group("lo")), int(m.group("hi"))], "note": re.sub(r"\s+", " ", m.group("rest") or "").strip(" ,")}
    return out


# ── forecasts ───────────────────────────────────────────────────────────────────────────────────

_FORECAST = re.compile(r"forecasts? for (?:the )?(?P<area>[A-Za-z ,'-]{4,90}?)\s*[,.]?\s*(?:this (?:afternoon|evening|morning)|today|tonight|overnight)\b", re.I)


def forecasts(text: str, limit: int = 700) -> list[dict]:
    """The zone forecasts, each as the area and the first stretch of text (enough for a briefing line)."""
    marks = [m for m in _FORECAST.finditer(text) if "coastal" not in m.group("area").lower()
             and "waters" not in m.group("area").lower()]
    out = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = re.sub(r"\s+", " ", text[m.start() + len(m.group(0)) - len(m.group(0).split()[-1]) - (len(m.group(0).split()[-2]) + 1 if m.group(0).lower().split()[-2:-1] == ["this"] else 0):end]).strip()
        body = re.split(r"high and low temperatures at", body, flags=re.I)[0].strip()
        out.append({"area": re.sub(r"\s+", " ", m.group("area")).strip().title(), "text": body[:limit]})
    latest: dict[str, dict] = {}
    for f in out:                                         # the loop repeats: keep the most recent text for each area
        latest[f["area"]] = f
    return list(latest.values())


# ── everything ──────────────────────────────────────────────────────────────────────────────────

def parse(chunks: list[dict], office_code: str | None) -> dict:
    """Parse a window of transcript chunks. Sections absent from the window come back empty, not guessed."""
    office = Office(office_code)
    raw = stitch(chunks)
    text, marks = stitch_marked([{**c, "text": digitize(str(c.get("text", "")))} for c in chunks])
    return {
        "notices": notices(text, office, marks),
        "observations": observations(text, office),
        "rivers": rivers(raw, office),            # place names may contain number words ("Three Lynx")
        "marine": marine(text),
        "forecasts": forecasts(raw),             # prose: keep the words as spoken
        "chars": len(text),
        "parsed_at": datetime.now(timezone.utc).isoformat(),
    }


# ── notices over time ───────────────────────────────────────────────────────────────────────────

class NoticeBook:
    """What the station has been announcing, accumulated across refreshes.

    A notice repeats every loop with random transcription noise, so each loop is one vote for the wording it was
    heard as, counted once however many times it is re-parsed, and the wording with most votes is shown. A notice
    is `active` while it keeps being heard and is dropped after a day off the air. JSON-serialisable so it survives
    a restart."""

    ACTIVE_S = 45 * 60          # about three loops without hearing it means it has left the air
    FORGET_S = 24 * 3600
    MAX_LOOPS = 300

    def __init__(self, state: dict | None = None):
        self.items: dict[str, dict] = (state or {}).get("items", {})

    def update(self, found: list[dict], now: float) -> None:
        for n in found:
            item = self.items.setdefault(n["id"], {"votes": {}, "loops": [], "first_seen": None, "last_seen": None})
            for loop in n.get("loops", []):
                when = loop.get("at") or now
                key = f"{when:.0f}"
                if key in item["loops"]:
                    continue
                item["loops"] = (item["loops"] + [key])[-self.MAX_LOOPS:]
                item["votes"][loop["text"]] = item["votes"].get(loop["text"], 0) + 1
                item["last_seen"] = when if item["last_seen"] is None else max(item["last_seen"], when)
                item["first_seen"] = when if item["first_seen"] is None else min(item["first_seen"], when)
            if item["last_seen"] is None:                      # a notice reported with no dated loops
                item["first_seen"] = item["last_seen"] = now
        for gone in [k for k, v in self.items.items() if now - v["last_seen"] > self.FORGET_S]:
            del self.items[gone]

    def current(self, now: float) -> list[dict]:
        out = []
        for nid, item in self.items.items():
            if not item["votes"]:
                continue
            text = max(item["votes"], key=lambda t: (not re.search(r"[.!?]\s+[a-z]", t), item["votes"][t], len(t)))
            out.append({"id": nid, "title": text.split(".")[0].strip().title(), "text": text,
                        "first_seen": datetime.fromtimestamp(item["first_seen"], timezone.utc).isoformat(),
                        "last_seen": datetime.fromtimestamp(item["last_seen"], timezone.utc).isoformat(),
                        "heard": sum(item["votes"].values()),
                        "active": now - item["last_seen"] <= self.ACTIVE_S})
        return sorted(out, key=lambda n: (not n["active"], n["first_seen"]))

    def state(self) -> dict:
        return {"items": self.items}


# ── checking a spoken river reading against the official one ────────────────────────────────────

STAGE_MATCH_FT = 0.15       # the broadcast rounds to a tenth of a foot and NOAA to a hundredth
STAGE_CLOSE_FT = 0.5
FLOW_MATCH = 0.08           # relative
STALE_OFFICIAL_S = 3 * 3600


def compare_river(radio: dict, official: dict | None, now: float) -> dict:
    """How a gauge reading heard on the radio compares with NOAA's own: `official` is {"stage_ft", "flow_cfs", "at"}
    (epoch seconds) or None when it could not be fetched. Status:
      match / close / differs   the two stages agree, roughly agree, or do not
      radio_missing             the broadcast said "report was missing" but NOAA has a value
      no_data                   neither has a reading
      unchecked                 no official reading to compare with
    Speech-to-text slips (a digit heard wrong) show up as `differs`, which is the point: the radio is a hint, NOAA is
    the record, and the mismatch is worth seeing."""
    out = {"status": "unchecked", "official": official}
    have = official and official.get("stage_ft") is not None and official["stage_ft"] > -900
    if radio.get("missing"):
        out["status"] = "radio_missing" if have else "no_data"
        return out
    if not have:
        return out
    diff = abs(radio["stage_ft"] - official["stage_ft"])
    out["stage_diff_ft"] = round(diff, 2)
    out["status"] = "match" if diff <= STAGE_MATCH_FT else "close" if diff <= STAGE_CLOSE_FT else "differs"
    if radio.get("flow_cfs") and official.get("flow_cfs"):
        rel = abs(radio["flow_cfs"] - official["flow_cfs"]) / max(official["flow_cfs"], 1)
        out["flow_diff_pct"] = round(100 * rel, 1)
        if rel > FLOW_MATCH and out["status"] == "match":
            out["status"] = "close"                      # stage agrees but the spoken flow is off: likely a misheard digit
    if official.get("at") and now - official["at"] > STALE_OFFICIAL_S:
        out["official_stale"] = True
    return out


# ── current conditions from the radio ───────────────────────────────────────────────────────────

_HOUR = re.compile(r"^(\d{1,2}) ([AP])M$")
MAX_OBS_AGE_S = 3 * 3600


def home_observation(obs: dict, office: Office, tz_name: str, now: datetime) -> dict | None:
    """The latest hourly observation for the office's home city in the shape of the NWS current-conditions feed, for
    use when that feed is down; None when the broadcast has not named the city or the reading is too old.

    The broadcast says only the hour ("4 PM"); it is placed on today in `tz_name`, or yesterday when that would be in
    the future (just after midnight, reading the 11 PM block)."""
    from zoneinfo import ZoneInfo

    m = _HOUR.match(obs.get("hour") or "")
    station = next((s for s in obs.get("stations", []) if s["place"] == office.home), None) if office.home else None
    if not m or not station:
        return None
    zone = ZoneInfo(tz_name)
    local_now = now.astimezone(zone)
    hour = int(m.group(1)) % 12 + (12 if m.group(2) == "P" else 0)
    observed = local_now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if observed > local_now + _dt.timedelta(minutes=5):
        observed -= _dt.timedelta(days=1)
    if (local_now - observed).total_seconds() > MAX_OBS_AGE_S:
        return None
    return {
        "station": f"NOAA Weather Radio ({office.home})", "timestamp": observed.astimezone(timezone.utc).isoformat(),
        "temp_f": float(station["temp_f"]), "wind_mph": station.get("wind_mph"), "wind_gust_mph": station.get("gust_mph"),
        "wind_dir": {"N": "N", "S": "S", "E": "E", "W": "W"}.get(station.get("wind_dir") or "", station.get("wind_dir")),
        "condition": (station.get("sky") or "").capitalize() or None, "humidity": None,
        "pressure_in": station.get("pressure_in"), "source": "nwr",
    }
