"""Tests for the daily purge schedule.

Run from poller/:
    pytest tests/test_purge_schedule.py
"""
from __future__ import annotations

import os
import sys

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

from db import PURGE_INTERVAL_S, PURGE_SETTLE_S, next_purge_delay

NOW = 1_800_000_000.0


def test_never_purged_runs_soon_after_start():
    assert next_purge_delay(None, NOW) == PURGE_SETTLE_S


def test_a_recent_purge_is_not_repeated_after_a_restart():
    two_hours_ago = NOW - 2 * 3600
    assert next_purge_delay(two_hours_ago, NOW) == PURGE_INTERVAL_S - 2 * 3600


def test_an_overdue_purge_runs_after_the_settle_delay_not_a_full_hour_later():
    assert next_purge_delay(NOW - 3 * PURGE_INTERVAL_S, NOW) == PURGE_SETTLE_S


def test_frequent_restarts_no_longer_starve_the_purge():
    """Old behaviour slept 1 h from every start, so a poller restarted more often than hourly never purged."""
    last = NOW - PURGE_INTERVAL_S - 60          # due a minute ago
    assert next_purge_delay(last, NOW) == PURGE_SETTLE_S
