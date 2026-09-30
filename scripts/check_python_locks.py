#!/usr/bin/env python3
"""Fail when a direct Python dependency is absent or stale in its lockfile."""

from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


ROOT = Path(__file__).resolve().parents[1]
SERVICES = ("backend", "poller", "transcription")


def requirements(path: Path):
    for raw_line in path.read_text().splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        yield Requirement(line)


def locked_versions(path: Path) -> dict[str, str]:
    versions: dict[str, str] = {}
    for requirement in requirements(path):
        exact = [item.version for item in requirement.specifier if item.operator == "=="]
        if len(exact) == 1:
            versions[canonicalize_name(requirement.name)] = exact[0]
    return versions


def main() -> int:
    errors: list[str] = []
    for service in SERVICES:
        manifest_path = ROOT / service / "requirements.txt"
        lock_path = ROOT / service / "requirements.lock"
        lock = locked_versions(lock_path)

        for requirement in requirements(manifest_path):
            if requirement.marker and not requirement.marker.evaluate():
                continue
            name = canonicalize_name(requirement.name)
            version = lock.get(name)
            if version is None:
                errors.append(f"{service}: {requirement.name} is missing from requirements.lock")
            elif requirement.specifier and not requirement.specifier.contains(
                version, prereleases=True
            ):
                errors.append(
                    f"{service}: {requirement.name}{requirement.specifier} "
                    f"does not match locked version {version}"
                )

    if errors:
        print("Python manifest/lock mismatch:")
        for error in errors:
            print(f"- {error}")
        print("Regenerate locks with the commands in DEPENDENCIES.md.")
        return 1

    print("Python manifests and locks are synchronized.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
