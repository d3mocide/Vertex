"""
EMS patient-report activity from hospital radio talkgroups.

Medics radio a pre-arrival report to the receiving hospital ("code 1 with a 74-year-old female, chief complaint
chest pain, vitals ... ETA ten minutes"). Individually these are routine and private, so they never become radio
incidents (see radio_incidents.is_hospital_tag). In aggregate they are an early view of what the region's EMS system
is dealing with, so this module turns them into hourly syndrome counts and flags unusual volumes (overdose cluster,
heat illness during a heat wave, a respiratory surge during smoke) against a time-of-day-matched baseline.

Only counts are kept; no transcript text, ages or places are stored.

Pure and synchronous apart from the DB helpers at the bottom, so it can be unit-tested against transcripts.
"""
from __future__ import annotations

import logging
import math
import re
import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

TOTAL = "_reports"

# key -> (label, pattern). Patterns are matched on lower-cased ASR text; negated or historical mentions are
# discarded (see _positive), so "stroke negative" / "history of seizures" / "no chest pain" do not count.
_S: dict[str, tuple[str, str]] = {
    "stroke": ("Stroke", r"stroke (?:alert|activation|code)|(?:alert|activation) for (?:a )?stroke|\b(?:bfast|b fast|bfas|befast|be fast|b-fast)\b|facial droop|last known (?:well|normal)"),
    "cardiac": ("Cardiac", r"\bstemi\b|chest pain|heart attack|cardiac arrest|\bcpr\b|\brosc\b|\ba-?fib\b|\bsvt\b|palpitation|post[- ]arrest"),
    "trauma": ("Major trauma", r"gunshot|\bgsw\b|stab wound|stabbing wound|\bstabbed\b|motor vehicle|\bmvc\b|\bmva\b|car accident|vehicle accident|car crash|collision|struck by|head injury|fracture"),
    "fall": ("Falls", r"\bfall\b|\bfell\b|\bfallen\b"),
    "tox": ("Overdose / intoxication", r"overdose|narcan|naloxone|intoxicat|\betoh\b|opioid|withdrawal|ingest|poison|substance (?:abuse|use)|\bmeth\b|cocaine|alcohol"),
    "psych": ("Psychiatric / self-harm", r"psychiatric|\bpsych\b|suicid|self[- ]harm|homicidal|hallucinat|delusion|schizophren|bipolar|involuntary|(?:placed )?on a (?:\w+ )?hold\b"),
    "respiratory": ("Respiratory", r"shortness of breath|respiratory distress|\bcopd\b|asthma|wheez|difficulty breathing|trouble breathing|breathing (?:problem|difficulty)|hypoxi|\bsob\b"),
    "infection": ("Infection / sepsis", r"sepsis alert|septic|sepsis positive|infection|\bfever\b|febrile|\buti\b|pneumonia|cellulitis|\bflu\b|covid"),
    "heat_cold": ("Heat / cold illness", r"heat (?:stroke|exhaustion|illness|related|exposure)|hyperthermi|hypotherm|overheat|frostbite|dehydrat"),
    "seizure": ("Seizure", r"seizure|post-?ictal|convuls"),
    "obstetric": ("Obstetric", r"pregnan|contractions|miscarriage|postpartum|water broke|labor and delivery"),
    "pediatric": ("Pediatric", r"month[- ]old|infant|toddler|newborn|pediatric|\bchild\b|\bchildren\b"),
    "exposure": ("Burn / smoke / CO", r"smoke inhalation|\bburns?\b|carbon monoxide|\bco poison|chemical exposure"),
    "alert": ("Activations (stroke / STEMI / trauma / sepsis)", r"(?:stroke|stemi|sepsis|trauma|cardiac|code) (?:alert|activation)|alert activation|trauma alert"),
}
SYNDROMES: dict[str, tuple[str, re.Pattern]] = {k: (label, re.compile(p)) for k, (label, p) in _S.items()}

_NEG_BEFORE = {"no", "not", "denies", "denied", "without", "negative", "neg", "never", "history", "hx", "prior", "previous",
               "previously", "past", "will", "might", "risk", "afraid", "feels", "feel", "t"}   # "t" = the n't in "doesn't"
_NEG_AFTER = {"negative", "neg"}


def _positive(text: str, pat: re.Pattern) -> bool:
    """True when the pattern matches somewhere that is not negated, historical or hypothetical."""
    for m in pat.finditer(text):
        before = re.findall(r"[a-z']+", text[max(0, m.start() - 40):m.start()])[-3:]
        after = re.findall(r"[a-z']+", text[m.end():m.end() + 25])[:2]
        if any(w in _NEG_BEFORE for w in before) or any(w in _NEG_AFTER for w in after):
            continue
        return True
    return False


def classify_report(text: str) -> set[str]:
    """Syndrome keys a patient report describes (possibly several, possibly none)."""
    t = (text or "").lower()
    return {k for k, (_, pat) in SYNDROMES.items() if _positive(t, pat)}


@dataclass
class Report:
    ts: datetime
    tag: str
    text: str
    calls: int = 1


def merge_reports(rows, is_hospital, gap_s: float = 90.0) -> list[Report]:
    """rows: (ts, tgid, tag, text). One patient report arrives as several transmissions (pauses, the hospital's
    questions, the medic's answers), so same-channel calls less than `gap_s` apart count as one report."""
    calls = sorted(((ts, tag or "", text or "") for ts, _tg, tag, text in rows if is_hospital(tag) and (text or "").strip()),
                   key=lambda c: (c[1], c[0]))
    reports: list[Report] = []
    last = None
    for ts, tag, text in calls:
        if reports and reports[-1].tag == tag and last is not None and (ts - last).total_seconds() <= gap_s:
            reports[-1].text += " " + text
            reports[-1].calls += 1
        else:
            reports.append(Report(ts=ts, tag=tag, text=text))
        last = ts
    return reports


def _hour(ts: datetime) -> datetime:
    ts = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def hourly_counts(reports: list[Report]) -> dict[tuple[datetime, str], int]:
    """{(hour, syndrome-or-TOTAL): reports}. Hours with at least one report always carry a TOTAL row, which is how
    "no data" is told apart from "no cases"."""
    out: dict[tuple[datetime, str], int] = {}
    for r in reports:
        h = _hour(r.ts)
        out[(h, TOTAL)] = out.get((h, TOTAL), 0) + 1
        for k in classify_report(r.text):
            out[(h, k)] = out.get((h, k), 0) + 1
    return out


# ── Surge detection ──────────────────────────────────────────────────────────

def _window_sum(counts: dict[tuple[datetime, str], int], end: datetime, hours: int, key: str) -> int:
    return sum(counts.get((end - timedelta(hours=i), key), 0) for i in range(hours))


def _coverage(counts: dict[tuple[datetime, str], int], end: datetime, hours: int) -> float:
    return sum(1 for i in range(hours) if (end - timedelta(hours=i), TOTAL) in counts) / hours


def _baseline(counts, end: datetime, hours: int, key: str, days: int, min_coverage: float = 0.75) -> list[int]:
    """The same hour-of-day window on each of the previous `days` days (so day/night patterns cancel out), skipping
    days the feed was largely missing."""
    vals = []
    for d in range(1, days + 1):
        e = end - timedelta(days=d)
        if _coverage(counts, e, hours) >= min_coverage:
            vals.append(_window_sum(counts, e, hours, key))
    return vals


def _expected(vals: list[int]) -> tuple[float, float]:
    med = statistics.median(vals)
    mad = statistics.median([abs(v - med) for v in vals]) * 1.4826
    return med, max(math.sqrt(max(med, 0.0)), mad, 1.0)


def surge_report(counts: dict[tuple[datetime, str], int], now: datetime, *, baseline_days: int = 14,
                 min_baseline_days: int = 5, z: float = 3.0, min_count: int = 4) -> dict:
    """Compare the last 24 h and last 6 h of patient reports with the same windows on earlier days."""
    end = _hour(now)
    out: dict = {"ts": now.isoformat(), "window_hours": 24, "baseline_days": 0, "building": True,
                 "reports": _window_sum(counts, end, 24, TOTAL), "reports_baseline": None, "syndromes": [], "flags": []}
    days_ok = len(_baseline(counts, end, 24, TOTAL, baseline_days))
    out["baseline_days"] = days_ok
    out["building"] = days_ok < min_baseline_days
    if not out["building"]:
        out["reports_baseline"] = round(statistics.median(_baseline(counts, end, 24, TOTAL, baseline_days)), 1)
    for key, (label, _) in SYNDROMES.items():
        row = {"key": key, "label": label, "count": _window_sum(counts, end, 24, key), "count_6h": _window_sum(counts, end, 6, key),
               "baseline": None, "baseline_6h": None, "flag": False}
        if not out["building"]:
            for win, ck, bk, min_c in ((24, "count", "baseline", min_count), (6, "count_6h", "baseline_6h", min_count)):
                vals = _baseline(counts, end, win, key, baseline_days)
                if len(vals) < min_baseline_days:
                    continue
                med, sigma = _expected(vals)
                row[bk] = round(med, 1)
                if row[ck] >= min_c and row[ck] >= med + z * sigma:
                    row["flag"] = True
        out["syndromes"].append(row)
        if row["flag"]:
            out["flags"].append(key)
    return out


# ── Database helpers ─────────────────────────────────────────────────────────

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS ems_syndrome_hourly (
    hour TIMESTAMPTZ NOT NULL,
    syndrome VARCHAR(32) NOT NULL,
    n INTEGER NOT NULL,
    PRIMARY KEY (hour, syndrome)
)"""


async def ensure_table(pool) -> None:
    await pool.execute(CREATE_SQL)


async def refresh_counts(pool, is_hospital, since: datetime) -> int:
    """Recompute and upsert the hourly counts for every hour from `since` on, from the transcripts still on disk.
    Idempotent. Older hours are never touched, so counts outlive the transcripts' retention."""
    since = _hour(since)
    rows = await pool.fetch(
        "SELECT started_at, tgid, tag, transcription FROM p25_recordings "
        "WHERE started_at >= $1 AND length(coalesce(transcription, '')) >= 20 ORDER BY started_at", since)
    counts = hourly_counts(merge_reports([tuple(r) for r in rows], is_hospital))
    # An hour that now has fewer reports than stored (transcripts purged mid-hour) must not shrink: keep the max.
    if counts:
        await pool.executemany(
            "INSERT INTO ems_syndrome_hourly (hour, syndrome, n) VALUES ($1, $2, $3) "
            "ON CONFLICT (hour, syndrome) DO UPDATE SET n = GREATEST(ems_syndrome_hourly.n, EXCLUDED.n)",
            [(h, k, n) for (h, k), n in counts.items()])
    return len(counts)


async def load_counts(pool, since: datetime) -> dict[tuple[datetime, str], int]:
    rows = await pool.fetch("SELECT hour, syndrome, n FROM ems_syndrome_hourly WHERE hour >= $1", since)
    return {(r["hour"], r["syndrome"]): r["n"] for r in rows}


async def purge_old(pool, keep_days: int = 120) -> None:
    await pool.execute("DELETE FROM ems_syndrome_hourly WHERE hour < now() - make_interval(days => $1)", keep_days)
