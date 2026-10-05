# Vertex Dependency Maintenance

Last audited: 2026-09-30.

## Sources of truth

| Stack | Direct manifest | Production lock | Installed by |
|---|---|---|---|
| Frontend | `frontend/package.json` | `frontend/package-lock.json` | `npm ci` |
| Backend | `backend/requirements.txt` | `backend/requirements.lock` | backend image and CI |
| Poller | `poller/requirements.txt` | `poller/requirements.lock` | poller image and CI |
| Transcription | `transcription/requirements.txt` | `transcription/requirements.lock` | transcription image and CI |

Python direct dependencies use exact pins except for intentionally minimum-bounded
libraries such as MeshCore. Production and CI install the compiled lockfiles, not
the direct manifests. Frontend production installs use the npm lockfile.

`scripts/check_python_locks.py` verifies that every direct Python constraint is
satisfied by its production lock. The dependency-audit CI job runs this check so
a PR cannot pass while changing only a direct manifest.

## System packages in images

Beyond the lockfiles, the poller image installs two Debian packages with `apt-get`: `curl` and `ca-certificates`
(fetching the aircraft and airport data at build time) and `libjemalloc2`, the allocator the poller process runs
under (`LD_PRELOAD`, see `poller/Dockerfile`). jemalloc is a long-established allocator (used by Redis, Firefox and
others) taken from the pinned Debian base image's own repository, so it follows the base image's security updates.
It exists because glibc's allocator fragmented the poller's heap to 850-1000 MB with about 125 MB of live data; under
jemalloc the same workload runs at about 250 MB. Remove it by deleting the `LD_PRELOAD` line if it ever misbehaves.

## Regenerating Python locks

Use Python 3.12 and the audited pip-tools release:

```bash
python3.12 -m venv /tmp/vertex-pip-tools
/tmp/vertex-pip-tools/bin/pip install pip-tools==7.5.2
/tmp/vertex-pip-tools/bin/pip-compile --upgrade --strip-extras \
  backend/requirements.txt --output-file backend/requirements.lock
/tmp/vertex-pip-tools/bin/pip-compile --upgrade --strip-extras \
  poller/requirements.txt --output-file poller/requirements.lock
/tmp/vertex-pip-tools/bin/pip-compile --upgrade --strip-extras \
  transcription/requirements.txt --output-file transcription/requirements.lock
/tmp/vertex-pip-tools/bin/pip install packaging==26.3
/tmp/vertex-pip-tools/bin/python scripts/check_python_locks.py
```

Review the complete lock diff. A direct update can legitimately change multiple
transitive packages; it should never silently remove an application dependency.

## Audit commands

Audit what production actually installs:

```bash
pip-audit -r backend/requirements.lock
pip-audit -r poller/requirements.lock
pip-audit -r transcription/requirements.lock
npm --prefix frontend audit --audit-level=moderate
```

The 2026-09-30 audit returned no known vulnerabilities for all three Python
locks and zero npm vulnerabilities.

## Required validation

For a dependency change, run at minimum:

```bash
docker build -t vertex-backend ./backend
docker build -t vertex-poller ./poller
docker build -t vertex-transcription ./transcription
docker build -t vertex-frontend ./frontend
docker run --rm --user root --entrypoint sh vertex-backend \
  -c 'pip install pytest==9.1.1 pytest-asyncio==1.4.0 && pytest tests/ -q'
docker run --rm --user root --entrypoint sh vertex-poller \
  -c 'pip install pytest==9.1.1 pytest-asyncio==1.4.0 && pytest tests/ -q'
npm --prefix frontend ci
npm --prefix frontend exec tsc -- --noEmit
npm --prefix frontend run build
```

Also render each supported Compose profile and run targeted integration smokes
for changed services. A clean build or unit suite is not a substitute for the
operator's live production test.

## Deliberately deferred major upgrades

- `bcrypt` 5: incompatible with Passlib 1.7.4 and rejects passwords longer than
  72 bytes while Vertex accepts up to 128 characters. This requires a coordinated
  password-hashing migration.
- React 19: requires React, ReactDOM, types, and application behavior to move
  together. ReactDOM remains on the React 18 peer line.
- Tailwind CSS 4: moves the PostCSS plugin to `@tailwindcss/postcss` and requires
  a coordinated configuration and stylesheet migration. A direct version bump
  fails the production build.
- `pyModeS` 3: replaces the v2 decoder API used by the BEAST ingest path. The
  current v2-only tests are intentionally required and would otherwise be skipped.
- Node build-runtime majors: remain on the digest-pinned Node 24 LTS line until a
  deliberate build-runtime review.

These exclusions are encoded in `.github/dependabot.yml`; see
[docs/reviews/dependabot-2026-09-29.md](docs/reviews/dependabot-2026-09-29.md) for the PR-by-PR evidence.

## Dependabot workflow

Routine minor and patch updates are grouped, while security updates remain
independent. Dependabot currently edits Python direct manifests but does not
regenerate the pip-compile locks. For an accepted Python PR:

1. Apply or reproduce the requested direct pin change.
2. Regenerate all affected locks with Python 3.12.
3. Run the lock consistency check, vulnerability audits, tests, and image builds.
4. Land the consolidated result on `main`; close the superseded bot branch rather
   than merging a manifest-only PR.
