# Dependabot PR Review

**Review date:** 2026-09-29
**Repository:** `d3mocide/vertex`
**Scope:** 25 open Dependabot version-update PRs, #139 through #163.

## Outcome

All 25 PRs can be closed after the consolidated dependency/security commit lands on `main`:

- 7 were already superseded by the security update.
- 15 valid upgrades were incorporated into the consolidated locks or immutable CI-action pins and validated together.
- 3 incompatible or premature major upgrades were rejected and are now explicitly deferred in `.github/dependabot.yml`.

No individual Dependabot branch should be merged. They were generated from the pre-remediation manifests, do not contain the complete audited lock state, and several replace exact pins with ranges or mutable action tags.

## PR disposition

| PR | Request | Disposition | Evidence |
|---|---|---|---|
| #139 | `actions/setup-node` v7 | Incorporated | v7.0.0 tag resolved and pinned to commit `8207627...`; workflow retains Node 24. |
| #140 | Node 20 to 26 build image | Rejected | Vertex is now on digest-pinned Node 24 LTS. A non-LTS/major build-runtime change is not needed for an advisory and should be reviewed separately. |
| #141 | `actions/setup-python` v7 | Incorporated | v7.0.0 tag resolved and pinned to commit `5fda3b9...`. |
| #142 | `actions/checkout` v7 | Incorporated | Latest v7.0.1 tag resolved and pinned to commit `3d3c42e...`; this includes the safer fork-checkout behavior described in its release notes. |
| #143 | backend asyncpg 0.31.0 | Incorporated | Image build and all 248 backend tests pass. |
| #144 | transcription redis 8.1.0 | Incorporated | Image build, import smoke test, and authenticated Redis integration pass. |
| #145 | vite-plugin-pwa 1.3.0 | Already superseded | Exact version was already present; production PWA build passes. |
| #146 | material-symbols 0.47.5 | Already superseded | Exact version was already present; frontend build passes. |
| #147 | transcription pydantic-settings 2.15.0 | Incorporated | Environment-template and settings construction smoke tests pass. |
| #148 | python-multipart 0.0.32 | Already superseded | Exact version was already present; backend suite passes. |
| #149 | backend HTTPX 0.28.1 | Incorporated | Backend suite, outbound-request tests, and image build pass. |
| #150 | bcrypt 5.0.0 | Rejected | Passlib 1.7.4 cannot read bcrypt 5 version metadata, and bcrypt 5 rejects passwords over 72 bytes while Vertex accepts up to 128 characters. Keep audited bcrypt 3.2.2 until a coordinated password-hashing migration. |
| #151 | transcription asyncpg 0.31.0 | Incorporated | Image build and import smoke pass. |
| #152 | deck.gl extensions 9.4.0 | Already superseded | All deck.gl packages were already aligned at 9.4.0; TypeScript/build pass. |
| #153 | backend pydantic-settings 2.15.0 | Incorporated | Full backend suite and `.env.example` construction pass. |
| #154 | LiteLLM 1.102.1 | Incorporated | Transcription image builds and `litellm.atranscription` remains available with the expected asynchronous transcription response. |
| #155 | backend redis 8.1.0 | Incorporated | Authenticated Redis ping/set/get/publish integration passes. |
| #156 | PostCSS 8.5.28 | Already superseded | Exact version was already present; frontend build passes. |
| #157 | React and types 19.3.0 | Rejected | The PR leaves `react-dom` at 18.3.1, whose declared peer requirement is React `^18.3.1`. React 19 requires a coordinated React/ReactDOM/types/application migration. |
| #158 | aiomqtt 2.5.1 | Incorporated | Poller image builds, imports pass, and all 357 poller tests pass. |
| #159 | poller pydantic-settings 2.15.0 | Incorporated | Settings construction and full poller suite pass. |
| #160 | feedparser 6.0.14 | Incorporated | Release fixes Python 3.10+ parsing issues; parsing smoke and full poller suite pass. |
| #161 | sgp4 2.27 | Incorporated | Import and full poller suite pass. |
| #162 | MeshCore 2.3.14 | Already superseded | Exact version was already present; MeshCore tests pass. |
| #163 | gtfs-realtime-bindings 3.0.0 | Already superseded | Exact version was already present; poller build/tests pass. |

## Additional consistency upgrades

Dependabot's per-directory PR limits had not yet opened matching requests for every shared Python dependency. The consolidated update also aligns Redis 8.1.0 and asyncpg 0.31.0 across backend, poller, and transcription instead of leaving service-specific version skew.

The regenerated Python 3.12 lock files include complete transitive resolution. All three locks return no known vulnerabilities from `pip-audit`. The frontend lock returns zero vulnerabilities from `npm audit`.

## Flood prevention

`.github/dependabot.yml` now:

- monitors backend, poller, and transcription through one multi-directory pip configuration;
- groups routine minor/patch updates per ecosystem;
- groups GitHub Action version updates;
- caps simultaneous PRs more tightly;
- defers bcrypt major upgrades until the hashing stack is migrated;
- defers React/ReactDOM/types major upgrades until they can move together; and
- keeps the frontend build on manually reviewed LTS Node major lines.

Security-update PRs remain independent from routine grouped version updates so urgent advisories are not delayed by unrelated upgrades.

## Verification

- Backend: 248 passed, 3 skipped.
- Poller: 357 passed.
- Frontend strict TypeScript and production build: passed.
- Backend, poller, frontend, and transcription images: built.
- Authenticated Redis 8 client integration from all three Python images: passed.
- LiteLLM transcription API and upgraded poller imports: passed.
- npm audit: 0 vulnerabilities.
- Backend, poller, and transcription `pip-audit`: no known vulnerabilities.
- Base, MQTT, TLS, and development Compose rendering: passed.

The poller suite still reports two P25 recorder tasks pending at event-loop teardown after all assertions pass; this remains documented test-cleanup debt unrelated to these dependency versions.

## Post-push reconciliation (2026-09-30)

After the consolidated commit reached `main`, Dependabot applied the new grouping policy and opened five replacement PRs. Their dispositions are:

| PR | Request | Disposition | Evidence |
|---|---|---|---|
| #164 | Grouped routine Python updates | Incorporated | Production locks were regenerated; backend and poller suites, all service image builds, transcription imports, and all three vulnerability audits pass. |
| #165 | backend python-dateutil 2.9.0.post0 | Incorporated | Included in the regenerated backend lock and full backend suite. |
| #166 | poller python-dateutil 2.9.0.post0 | Incorporated | Included in the regenerated poller lock and full poller suite. |
| #167 | pyModeS 3.6.0 | Rejected | Vertex requires the pyModeS 2.x decoder API. The PR's green poller run skipped the v2-only decoder tests, so it did not establish compatibility. Major pyModeS updates are now ignored pending a deliberate decoder migration. |
| #168 | poller websockets 17.1 | Incorporated | The poller image, WebSocket call sites, and all 357 poller tests pass with the regenerated lock. |

This follow-up also found that Dependabot edits the direct `requirements.txt` manifests but not the `requirements.lock` files installed by CI and production images. `scripts/check_python_locks.py` is now part of the dependency-audit job, so a dependency PR cannot receive a green audit while leaving the production lock stale.
