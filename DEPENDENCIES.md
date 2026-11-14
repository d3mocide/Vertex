# Vertex Dependency Maintenance

Last audited: 2026-11-13.

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
/tmp/vertex-pip-tools/bin/pip install pip-tools==7.6.2 packaging==26.3
PATH=/tmp/vertex-pip-tools/bin:$PATH scripts/sync_python_locks.sh              # re-resolve, upgrade nothing
PATH=/tmp/vertex-pip-tools/bin:$PATH scripts/sync_python_locks.sh -P certifi   # upgrade one package
PATH=/tmp/vertex-pip-tools/bin:$PATH scripts/sync_python_locks.sh --upgrade    # refresh everything
/tmp/vertex-pip-tools/bin/python scripts/check_python_locks.py
```

Review the complete lock diff. A direct update can legitimately change multiple
transitive packages; it should never silently remove an application dependency.
Prefer `-P <package>` over `--upgrade`: a blanket upgrade has moved unrelated packages across major versions.

## Dependabot and the locks

Dependabot only edits the direct manifests, so `.github/workflows/dependabot-locks.yml` regenerates the locks on
its PR branches (`scripts/sync_python_locks.sh`, `npm install --package-lock-only`), pushes them and re-runs the
tests. Merge a Dependabot PR once its checks are green; there is nothing to do by hand.

Dependabot never sees a vulnerable *transitive* Python package (`certifi`, `aiohttp`, `opentelemetry-api` sat in
the locks unflagged). The weekly scheduled run of the Tests workflow audits every lock, so such a finding fails a
run within a week. Fix it with `scripts/sync_python_locks.sh -P <package>`.

## Vulnerabilities with no fix yet

If an advisory can't be fixed (the fix needs a version an upstream package forbids), add a line to
`.github/audit-ignores.txt`: advisory id, which lock, an expiry date (weeks, not months) and why it's safe to wait.
`scripts/audit_python_locks.py` skips it until that date and then fails the audit, so it comes back for review.
npm findings below the CI threshold (`--audit-level=moderate`) are not blocked; note them in the task log.

## Frontend overrides

`frontend/package.json` pins `glob` to 14.0.2 through `overrides`: `workbox-build` (pulled in by `vite-plugin-pwa`) asks for
`glob` 11, which is affected by GHSA-3g3m-2fjr-6pw4 (fixed in 14.0.2; its `minimatch` then resolves to the fixed 11.x,
GHSA-g3hv-75wg-m249). Checked 2026-11-13: `npm run build` still generates the service worker (precache of the built
files). Remove the override once `workbox-build` depends on a fixed `glob`. Four low-severity `npm audit` findings remain
(`deepmerge` via `workbox-build`, no patched release); CI audits at `--audit-level=moderate`, so they do not fail it.

`@vitejs/plugin-react` stays at 6.1.2: 6.2.1 makes `npm install` fail with an unresolvable peer conflict (its optional
`@rolldown/plugin-babel` peer pulls `@babel/plugin-transform-runtime` 8, which needs `@babel/core` 8). Checked 2026-11-14;
retry the bump when a newer release resolves it.

