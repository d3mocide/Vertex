"""FAA NAS Status parsing, filtering and advisory promotion."""
import advisories as adv
from pollers import nas_status as nas

XML = b"""<AIRPORT_STATUS_INFORMATION><Update_Time>now</Update_Time>
<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List><Program><ARPT>PDX</ARPT><Reason>wind</Reason><End_Time>6:15 pm PST</End_Time></Program></Ground_Stop_List></Delay_type>
<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>SFO</ARPT><Reason>wind</Reason><Avg>2 hours</Avg><Max>5 hours</Max></Ground_Delay></Ground_Delay_List></Delay_type>
<Delay_type><Name>General</Name><Arrival_Departure_Delay_List><Delay><ARPT>SEA</ARPT><Reason>fog</Reason><Arrival_Departure Type="Departure"><Min>1 hour</Min><Max>2 hours</Max><Trend>Increasing</Trend></Arrival_Departure></Delay></Arrival_Departure_Delay_List></Delay_type>
<Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>PDX</ARPT><Reason>!PDX 1/1 PDX AD AP CLSD TO NON SKED TRANSIENT GA ACFT</Reason><Start>a</Start><Reopen>b</Reopen></Airport><Airport><ARPT>HIO</ARPT><Reason>!HIO 1/2 HIO AD AP CLSD 2611131600-2611140100</Reason><Start>a</Start><Reopen>Nov 14 at 01:00 UTC.</Reopen></Airport></Airport_Closure_List></Delay_type>
</AIRPORT_STATUS_INFORMATION>"""


def test_parse_reads_every_program_kind():
    d = nas.parse(XML)
    assert [p["kind"] for p in d["programs"]] == ["ground_stop", "ground_delay", "delay", "closure", "closure"]
    assert d["programs"][2]["direction"] == "Departure"


def test_filter_accepts_faa_and_icao_codes():
    d = nas.filter_programs(nas.parse(XML), nas.watched("kpdx, hio"))
    assert {p["airport"] for p in d["programs"]} == {"PDX", "HIO"}


def test_advisories_skip_partial_closures():
    items = adv.from_nas(nas.filter_programs(nas.parse(XML), {"PDX", "HIO"}))
    assert sorted(i["title"] for i in items) == ["HIO closed", "PDX ground stop"]
    assert all(i["level"] == "amber" for i in items)


def test_none_is_safe():
    assert adv.from_nas(None) == []


def test_airports_in_box_follows_the_bounding_box():
    box = nas.airports_in_box(44.8, 45.9, -123.5, -121.8)
    assert {"PDX", "HIO", "TTD"} <= box and "SEA" not in box


def test_national_counts_us_airports_only_and_flags_a_nationwide_stop():
    stops = "".join(f"<Program><ARPT>{c}</ARPT><Reason>x</Reason></Program>" for c in ("PDX", "SEA", "JFK", "ORD", "ATL", "YYZ"))
    xml = f"<A><Update_Time>t</Update_Time><Delay_type><Ground_Stop_List>{stops}</Ground_Stop_List></Delay_type></A>".encode()
    full = nas.parse(xml)
    d = nas.filter_programs(full, {"PDX"})
    d["national"] = nas.national(full)
    assert d["national"]["ground_stops"] == 5          # YYZ is not a US airport
    [flag, local] = sorted(adv.from_nas(d), key=lambda i: -i["score"])
    assert flag["title"] == "National ground stop" and local["title"] == "PDX ground stop"
    d["national"] = {"ground_stops": 4, "ground_delays": 0}
    assert [i["title"] for i in adv.from_nas(d)] == ["PDX ground stop"]


def _story(title, minutes=30, source="KOIN 6", local=2, topic="Transportation", others=()):
    from datetime import datetime, timedelta, timezone
    now = datetime(2026, 11, 13, 23, 0, tzinfo=timezone.utc)
    st = {"id": title[:5], "title": title, "published": (now - timedelta(minutes=minutes)).isoformat(),
          "source": source, "local": local, "topic": topic,
          "sources": [{"source": source, "link": ""}] + [{"source": o, "link": ""} for o in others]}
    return now, st


def test_news_headlines_about_a_big_event_become_one_amber_item():
    now, a = _story("FAA halts all flights in the US. How is that impacting PDX?")
    _, b = _story("Flights halted at PDX, airports nationwide", 45, "OPB News")
    _, c = _story("Nationwide FAA ground stop impacts flights at Portland International Airport", 60, "Portland Tribune")
    [item] = adv.from_news([a, b, c], now)
    assert item["source"] == "news" and item["level"] == "amber" and item["title"] == a["title"]
    assert item["detail"] == "reported by KOIN 6, OPB News, Portland Tribune"


def test_news_rules_need_recent_and_relevant_and_ignore_sports():
    now, old = _story("FAA ground stop", minutes=300)
    assert adv.from_news([old], now) == []                                           # too old
    _, far = _story("State of emergency declared in Florida", local=0)
    assert adv.from_news([far], now) == []                                           # not about here
    _, near = _story("Governor declares state of emergency across Oregon", local=1)
    assert [i["title"] for i in adv.from_news([near], now)] == [near["title"]]
    _, game = _story("Blazers ground stop Suns", topic="Sports")
    assert adv.from_news([game], now) == [] and adv.from_news(None, now) == []
