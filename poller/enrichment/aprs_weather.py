"""
APRS weather comment parser.

Handles Ultimeter/Davis-style weather data embedded in APRS position comments:
  050/010g015t072r000p000P000h50b10254
  wind 050°/010kts, gust 015kts, temp 72°F, rain 0.00", humidity 50%, pressure 1025.4mb
"""
import re
from typing import Optional

# Matches the standard positional Ultimeter/Davis WX comment block.
# Fields are individually optional and may appear in any order after the
# wind block. All numeric groups are ASCII digits; temp may be signed.
_WX_RE = re.compile(
    r"(?:(\d{3})/(\d{3}))?"     # wind_dir / wind_speed_kts
    r"(?:g(\d{3}))?"            # gust_kts
    r"(?:t(-?\d{3}))?"          # temp_F (signed)
    r"(?:r(\d{3}))?"            # rain_1h  (0.01 in)
    r"(?:p(\d{3}))?"            # rain_24h (0.01 in)
    r"(?:P(\d{3}))?"            # rain_midnight (0.01 in)
    r"(?:h(\d{2,3}))?"          # humidity pct  (00 → 100%)
    r"(?:b(\d{4,5}))?",         # pressure 0.1 mbar
    re.IGNORECASE,
)


def parse_wx_comment(comment: str) -> Optional[dict]:
    """Parse an Ultimeter/Davis-style APRS weather comment.

    Returns a dict with whichever fields are present, or None when the
    comment contains no recognisable WX data.
    """
    if not comment:
        return None

    m = _WX_RE.search(comment)
    if not m or not any(m.groups()):
        return None

    wind_dir, wind_spd, gust, temp, rain_1h, rain_24h, rain_mid, humidity, pressure = m.groups()

    result: dict = {}

    if temp is not None:
        result["temp_f"] = int(temp)

    if humidity is not None:
        h = int(humidity)
        # APRS encodes 100 % as "00"
        result["humidity"] = 100 if h == 0 else min(h, 100)

    if pressure is not None:
        result["pressure_mb"] = int(pressure) / 10.0

    if wind_dir is not None and wind_spd is not None:
        result["wind_dir_deg"] = int(wind_dir)
        result["wind_mph"] = round(int(wind_spd) * 1.15078, 1)  # kts → mph

    if gust is not None:
        result["gust_mph"] = round(int(gust) * 1.15078, 1)

    if rain_1h is not None:
        result["rain_in"] = int(rain_1h) / 100.0

    return result if result else None
