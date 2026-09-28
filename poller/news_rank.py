"""
News ranking — turns raw RSS items into ranked local stories.

* One story, one card: near-identical headlines from several outlets merge
  (word-set overlap), keeping every source's link.
* Topic by whole-word rules (Safety, Weather, Transportation, Government,
  Community, Sports, Other). Substring matching made "Earthquakes beat
  Timbers" a high-severity "intel alert".
* Local relevance 0-3: home-area places 3, metro 2, Oregon 1, else 0;
  sports and entertainment never rank above 1.
* `emergency` (what may raise a story to a priority event) needs a Safety or
  Weather topic, local relevance >= 2, a critical whole word, and no sports.

The local model can later override topic / relevance / summary / emergency
per story (news enrichment); these rules are the fallback.
"""
from __future__ import annotations

import email.utils
import hashlib
import re
from datetime import datetime, timezone

_STOP = set("a an the and or of to in on at for with by from as is are was were be been its it this that "
            "after over into amid says say new more than up out about how what why who".split())

_TOPICS: list[tuple[str, re.Pattern]] = [
    ("Sports", re.compile(r"\b(score[sd]?|beat|beats|game|games|coach|quarterback|qb|season|playoffs?|timbers|thorns|"
                          r"blazers|trail blazers|ducks|beavers|seahawks|nfl|nba|mls|nwsl|ncaa|goals?|touchdowns?|"
                          r"inning|halftime|earthquakes|winterhawks|pickles|hops|athletics?|tournament|shooting guard|point guard|"
                          r"signs with|draft|roster|free agent|unbeaten|streak|portland fire|wnba|mariners|kraken|"
                          r"routs?|wins|victory|defeats?|\d{1,3}-\d{1,3})\b", re.I)),
    ("Safety", re.compile(r"\b(fire|fires|wildfire|blaze|shooting|shot|stabb\w*|homicide|murder|crash|collision|police|"
                          r"sheriff|arrest\w*|evacuat\w*|hazmat|rescue\w*|missing|explosion|killed|dead|death|injur\w*|"
                          r"earthquake|quake|tsunami|emergency|lockdown|amber alert)\b", re.I)),
    ("Weather", re.compile(r"\b(storm|rain|snow|ice|wind|windstorm|heat|heat wave|weather|atmospheric river|flood(?:s|ing|ed|waters?)?|"
                           r"hurricane|tornado|smoke|air quality|freeze|forecast)\b", re.I)),
    ("Transportation", re.compile(r"\b(odot|traffic|road|roads|highway|freeway|i-5|i-205|i-84|i-405|hwy|trimet|max line|"
                                  r"bridge|closure|lanes?|detour|transit|airport|pdx)\b", re.I)),
    ("Government", re.compile(r"\b(council|commission\w*|county|city of|mayor|governor|legislat\w*|election|ballot|"
                              r"budget|ordinance|bond|levy|tax|school board|district|kotek|lawmakers?)\b", re.I)),
    ("Community", re.compile(r"\b(festival|things to do|event|events|market|library|parade|concert|fair|museum|"
                             r"restaurant|volunteer|school|students?)\b", re.I)),
]

_CRITICAL = re.compile(r"\b(earthquake|tsunami|wildfire|active shooter|shooting|evacuat\w*|hazmat|flood(ing|s)?|"
                       r"tornado|explosion|derail\w*|blackout|power outage|boil water|shelter in place|lockdown)\b", re.I)

HOME_PLACES = ["Tualatin", "Tigard", "Sherwood", "King City", "Durham", "Lake Oswego", "West Linn", "Wilsonville",
               "Bull Mountain", "Metzger", "Washington County", "TVF&R", "Tualatin Valley Fire"]
METRO_PLACES = ["Portland", "Beaverton", "Hillsboro", "Aloha", "Gresham", "Milwaukie", "Oregon City", "Happy Valley",
                "Clackamas", "Forest Grove", "Cornelius", "Newberg", "Canby", "Multnomah County", "Clackamas County",
                "TriMet", "PDX"]
_OREGON = re.compile(r"\b(oregon|ore\.|odot|salem|eugene|bend|medford|willamette|columbia river|mt\.? hood|coast)\b", re.I)
# Outlets that only publish about the home area.
HOME_SOURCES = {"city_of_tualatin", "city of tualatin"}


# Newswire datelines ("PORTLAND, Ore. (KOIN) — ...") say where the outlet is,
# not where the story is: a Wasco County wildfire is not Portland news.
_DATELINE = re.compile(r"^[A-Z][A-Z .'-]+,\s*(?:Ore\.|Oregon|Wash\.|Washington)?\s*(?:\([^)]*\))?\s*[\u2014\u2013-]+\s*")
_OBITUARY = re.compile(r"passed away|preceded in death|survived by|celebration of life|obituary|"
                       r"^\w+ \d{1,2}, \d{4} to \w+ \d{1,2}, \d{4}|^\d{4} to \d{4}", re.I)


def _places_re(places: list[str]) -> re.Pattern:
    return re.compile(r"\b(" + "|".join(re.escape(p) for p in places) + r")\b", re.I)


_HOME_RE = _places_re(HOME_PLACES)
_METRO_RE = _places_re(METRO_PLACES)


def parse_published(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        ts = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _words(title: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9']+", title.lower()) if w not in _STOP and len(w) > 2}


# Ties go to the more consequential topic ("wildfire season" is Safety).
_TIE_ORDER = ["Safety", "Weather", "Transportation", "Government", "Sports", "Community"]


def topic_of(text: str) -> str:
    """The topic with the most distinct matching words."""
    counts = {name: len({m.group(0).lower() for m in pat.finditer(text)}) for name, pat in _TOPICS}
    best = max(_TIE_ORDER, key=lambda n: (counts[n], -_TIE_ORDER.index(n)))
    return best if counts[best] else "Other"


def local_of(text: str, source: str) -> int:
    if source.lower() in HOME_SOURCES or _HOME_RE.search(text):
        return 3
    if _METRO_RE.search(text):
        return 2
    return 1 if _OREGON.search(text) else 0


def classify(item: dict) -> dict:
    """topic / local / emergency for one raw item (rules only)."""
    summary = _DATELINE.sub("", item.get("summary", "") or "")
    text = f"{item.get('title', '')} {summary}"
    if _OBITUARY.search(summary):
        return {"topic": "Obituaries", "local": min(1, local_of(text, item.get("source", ""))), "emergency": False}
    topic = topic_of(text)
    local = local_of(text, item.get("source", ""))
    if topic in ("Sports", "Community") and local > 1:
        local = 1
    emergency = (topic in ("Safety", "Weather") and local >= 2 and bool(_CRITICAL.search(text)))
    return {"topic": topic, "local": local, "emergency": emergency}


def stories(items: list[dict], now: datetime, similarity: float = 0.6) -> list[dict]:
    """Merge duplicate headlines into stories, classify and rank them."""
    out: list[dict] = []
    for item in sorted(items, key=lambda i: parse_published(i.get("published")) or now, reverse=True):
        words = _words(item.get("title", ""))
        match = None
        for s in out:
            union = words | s["_words"]
            if union and len(words & s["_words"]) / len(union) >= similarity:
                match = s
                break
        published = parse_published(item.get("published"))
        link = {"source": item.get("source", ""), "link": item.get("link", "")}
        if match:
            if link not in match["sources"]:
                match["sources"].append(link)
            if published and (match["published"] is None or published < parse_published(match["published"])):
                match["published"] = published.isoformat()   # first report
            continue
        story = {
            "id": hashlib.sha1((item.get("link") or item.get("title", "")).encode()).hexdigest()[:12],
            "title": item.get("title", ""),
            "summary": _DATELINE.sub("", item.get("summary", "") or ""),
            "source": item.get("source", ""),
            "link": item.get("link", ""),
            "published": published.isoformat() if published else (item.get("published") or ""),
            "category": item.get("category", "Regional News"),
            "sources": [link],
            **classify(item),
            "_words": words,
        }
        out.append(story)
    for s in out:
        del s["_words"]
        age_h = ((now - ts).total_seconds() / 3600) if (ts := parse_published(s["published"])) else 48
        # Local first; within a level, safety beats sports, fresh beats stale.
        s["score"] = round(s["local"] * 10 + (6 if s["emergency"] else 0)
                           + {"Safety": 3, "Weather": 3, "Transportation": 2, "Government": 2}.get(s["topic"], 0)
                           + (len(s["sources"]) - 1) * 2 - min(age_h, 48) / 6, 2)
    return sorted(out, key=lambda s: s["score"], reverse=True)
