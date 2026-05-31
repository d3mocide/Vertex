"""Tests for advisory feed text sanitization.

Run from poller/:
    pytest tests/test_alerts_clean_text.py
"""
from __future__ import annotations

import os
import sys

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

from pollers.alerts import _clean_text


def test_strips_double_encoded_tripcheck_markup():
    raw = (
        'Use alternate route. '
        '&amp;lt;a href="http://www.tripcheck.com"&amp;gt;TripCheck&amp;lt;/a&amp;gt;'
    )
    assert _clean_text(raw) == "Use alternate route. TripCheck"


def test_strips_single_encoded_tags():
    raw = "Crash west of Grand Ronde milepost 13 &lt;b&gt;cleared&lt;/b&gt;."
    assert _clean_text(raw) == "Crash west of Grand Ronde milepost 13 cleared ."


def test_passes_through_plain_text():
    assert _clean_text("Severe Thunderstorm Warning") == "Severe Thunderstorm Warning"


def test_collapses_whitespace_and_handles_empty():
    assert _clean_text("  multiple   spaces\n\tand lines ") == "multiple spaces and lines"
    assert _clean_text("") == ""
    assert _clean_text(None) == ""
