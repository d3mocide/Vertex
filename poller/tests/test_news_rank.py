"""News ranking: topics, local relevance, emergencies, story merging."""
from datetime import datetime, timezone

import news_rank as nr

NOW = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)


def _c(title, summary="", source="koin_6"):
    return nr.classify({"title": title, "summary": summary, "source": source})


def test_sports_team_names_are_not_emergencies():
    c = _c("Preston Judd scores 2 goals, Earthquakes beat Timbers 3-1, extend unbeaten streak to 6 games")
    assert c["topic"] == "Sports" and not c["emergency"]


def test_local_wildfire_is_an_emergency_and_far_one_is_not():
    assert _c("Wildfire forces evacuations near Sherwood")["emergency"]
    assert _c("New wildfire sparks south of The Dalles in Wasco County")["emergency"] is False   # not local
    assert _c("Wildfire season ends early")["topic"] == "Safety"


def test_local_relevance_levels():
    assert _c("Tualatin council approves budget")["local"] == 3
    assert _c("Portland bridge closure this weekend")["local"] == 2
    assert _c("Oregon QB Moore sustained concussion")["local"] <= 1
    assert _c("Mexico's Baja California braces for Hurricane Polo")["local"] == 0
    assert _c("Anything at all", source="city_of_tualatin")["local"] == 3


def test_words_inside_words_do_not_match():
    assert _c("Floodlights installed at stadium")["topic"] != "Weather"
    assert not _c("Shooting guard signs with Blazers in Portland")["emergency"]


def test_duplicate_headlines_merge_into_one_story_with_all_sources():
    items = [
        {"title": "Crash closes I-5 near Tualatin", "source": "koin_6", "link": "a", "published": "Sun, 28 Sep 2026 10:00:00 GMT"},
        {"title": "Crash closes I-5 near Tualatin for hours", "source": "opb_news", "link": "b", "published": "Sun, 28 Sep 2026 09:30:00 GMT"},
        {"title": "Fun things to do beginning Monday", "source": "portland_tribune", "link": "c", "published": "Sun, 28 Sep 2026 11:00:00 GMT"},
    ]
    out = nr.stories(items, NOW)
    assert len(out) == 2
    crash = out[0]
    assert crash["title"].startswith("Crash closes I-5") and len(crash["sources"]) == 2
    assert crash["published"].startswith("2026-09-28T09:30")          # first report
    assert out[1]["topic"] == "Community" and out[1]["local"] <= 1


def test_datelines_and_obituaries_do_not_make_stories_local():
    far = _c("New wildfire sparks south of The Dalles", "PORTLAND, Ore. (KOIN) \u2014 A new wildfire has sparked in Wasco County.")
    assert far["local"] <= 1 and not far["emergency"]
    obit = _c("David Rood", "May 10, 1931 to September 9, 2026 \u2013 David Rood of West Linn passed away.", "portland_tribune")
    assert obit == {"topic": "Obituaries", "local": 1, "emergency": False}
    assert _c("How the Portland Fire charmed Oregonians in their first season")["topic"] == "Sports"


def test_routine_city_notices_rank_below_local_news():
    items = [{"title": "Fall Registration at the Juanita Pohl Center", "source": "City of Tualatin", "link": "a",
              "published": "Sun, 28 Sep 2026 11:00:00 GMT"},
             {"title": "Crash closes Highway 99W in Tigard", "source": "KOIN 6", "link": "b",
              "published": "Sun, 28 Sep 2026 10:00:00 GMT"},
             {"title": "Phishing scam targeting Tigard permit customers", "source": "City of Tigard", "link": "c",
              "published": "Sun, 28 Sep 2026 09:00:00 GMT"}]
    order = [s["link"] for s in nr.stories(items, NOW)]
    assert order.index("a") == 2 and nr.classify(items[2])["topic"] == "Safety"
