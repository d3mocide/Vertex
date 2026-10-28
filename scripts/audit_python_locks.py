#!/usr/bin/env python3
"""pip-audit every production lock, skipping the dated exceptions in .github/audit-ignores.txt.

An exception that has expired fails the audit, so an accepted risk cannot be forgotten.
"""

import datetime
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IGNORES = ROOT / ".github" / "audit-ignores.txt"
SERVICES = ("backend", "poller", "transcription")


def parse_ignores(text: str, today: datetime.date):
    """Return ({service: [advisory ids]}, [problems]) from the ignore file's text."""
    ignored: dict[str, list[str]] = {service: [] for service in SERVICES}
    problems: list[str] = []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 3)
        if len(parts) < 4:
            problems.append(f"line {number}: expected '<id> <lock> <expires> <reason>' (a reason is required)")
            continue
        advisory, service, expires, _reason = parts
        if service not in ignored:
            problems.append(f"line {number}: unknown lock '{service}'")
            continue
        try:
            expiry = datetime.date.fromisoformat(expires)
        except ValueError:
            problems.append(f"line {number}: '{expires}' is not a YYYY-MM-DD date")
            continue
        if expiry < today:
            problems.append(f"line {number}: {advisory} ({service}) was accepted until {expires}; re-check it")
            continue
        ignored[service].append(advisory)
    return ignored, problems


def main() -> int:
    ignored, problems = parse_ignores(IGNORES.read_text(), datetime.date.today())
    if problems:
        print(f"{IGNORES.relative_to(ROOT)}:")
        for problem in problems:
            print(f"- {problem}")
        return 1
    failed = False
    for service in SERVICES:
        command = ["pip-audit", "-r", f"{service}/requirements.lock"]
        for advisory in ignored[service]:
            command += ["--ignore-vuln", advisory]
        if ignored[service]:
            print(f"{service}: accepted until fixed: {', '.join(ignored[service])}")
        failed |= subprocess.run(command, cwd=ROOT).returncode != 0
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
