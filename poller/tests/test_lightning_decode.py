import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from pollers.lightning import LightningPoller, _decode


def _encode(s: str) -> str:
    """Blitzortung-style LZW (the inverse of _decode) for round-trip checks."""
    table: dict[str, int] = {}
    code = 256
    phrase = s[0]
    out = []
    emit = lambda p: p if len(p) == 1 else chr(table[p])
    for ch in s[1:]:
        if phrase + ch in table or len(phrase + ch) == 1:
            phrase += ch
        else:
            out.append(emit(phrase))
            table[phrase + ch] = code
            code += 1
            phrase = ch
    out.append(emit(phrase))
    return "".join(out)


class LightningTests(unittest.TestCase):
    def test_decode_round_trips_a_strike_frame(self):
        strike = {"time": 1790651596899899100, "lat": 45.4123, "lon": -122.7611,
                  "sig": [{"sta": 11, "lat": 45.1, "lon": -122.3}] * 6}
        raw = json.dumps(strike, separators=(",", ":"))
        enc = _encode(raw)
        self.assertNotEqual(enc, raw)          # it really was compressed
        self.assertEqual(_decode(enc), raw)

    def test_uncompressed_text_passes_through(self):
        self.assertEqual(_decode("abc"), "abc")
        self.assertEqual(_decode(""), "")

    @patch("pollers.lightning.settings", SimpleNamespace(
        bbox_min_lat=44.8, bbox_max_lat=45.9, bbox_min_lon=-123.5, bbox_max_lon=-121.8))
    def test_parse_keeps_only_strikes_near_the_region(self):
        p = LightningPoller()
        near = {"time": 1790651596899899100, "lat": 45.4, "lon": -122.7}
        far = {"time": 1790651596899899100, "lat": 25.9, "lon": -104.5}
        self.assertEqual(len(p._parse_message(near)), 1)
        self.assertEqual(p._parse_message(far), [])


if __name__ == "__main__":
    unittest.main()
