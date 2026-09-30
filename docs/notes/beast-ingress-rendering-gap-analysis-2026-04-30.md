# BEAST Ingress + Rendering Pipeline Audit (Gap Analysis)

Date: 2026-04-30
Scope: Poller BEAST ingest/decode/snapshot path, backend transport/bootstrap path, frontend aircraft snapshot and trail rendering path.

Primary baseline documents:
- `research/beast-ultrafeeder-research.md`
- `research/beast-update-implimentation-tracker.md`

## 1. Executive Summary

The BEAST pipeline is operational and significantly more mature than the tracker currently states. Core ingest, bounded queueing, decode, 1 Hz snapshot broadcast, frontend trail reconstruction, and several runtime fixes are in place.

Overall maturity assessment:
- Functional maturity: high (production-usable)
- Architecture parity to research: medium-high (about 80-88% depending on section)
- Operational hardening: medium (several correctness and lifecycle risks remain)
- Documentation parity: low-medium (tracker and README currently contain stale/inconsistent statements)

Top risks found:
1. Snapshot freshness semantics are inaccurate in BEAST entities (`last_seen` reflects serialization time, not last message time).
2. HTTP poll mode does not publish empty snapshots, so stale aircraft can persist when source temporarily returns zero aircraft.
3. Change-detection publish filter ignores several BEAST-evolving fields, causing possible stream under-reporting for `entity_update` consumers.
4. Fire-and-forget enrichment tasks are untracked and unbounded at call sites.
5. Planning/tracker docs have internal contradictions and outdated completion claims.

## 2. Current-State Pipeline (As Implemented)

### 2.1 Poller ingest and decode

- BEAST transport task is started when `ADSB_ENABLE_BEAST` is enabled.
- Reconnect loop with exponential backoff is implemented.
- Frames are parsed with BEAST escape handling and fed into a bounded registry queue.
- Single worker consumes both `frame` and `tick` work items.
- Tick loop emits snapshots every 1 second.
- Decoder supports DF 4/5/11/17/18/20/21 with CPR tiers and Comm-B best-effort decoding.

Key implementation references:
- `poller/pollers/adsb.py`
- `poller/normalizers/beast_decoder.py`
- `poller/config.py`

### 2.2 Backend transport

- Poller writes snapshot to Redis `feed:aircraft_snapshot` and publishes `aircraft_snapshot` updates.
- Backend `/ws` sends bootstrap `snapshot` + `aircraft_snapshot`, then forwards Redis pub/sub payloads.
- Backend HTTP endpoints expose snapshot and airport map.

Key implementation references:
- `poller/bus.py`
- `backend/redis_bus.py`
- `backend/routers/ws.py`
- `backend/routers/aircraft.py`

### 2.3 Frontend rendering path

- `aircraft_snapshot` is merged through `setAircraftSnapshot` (not full state replacement).
- Server trail ring buffer (`trail_pts`) is preferred over client-only sparse accumulation.
- Gap segmentation and bridge suppression are implemented to prevent ghost/cross-map trail artifacts.

Key implementation references:
- `frontend/src/hooks/useWebSocket.ts`
- `frontend/src/store.ts`
- `frontend/src/layers/buildTrailLayers.ts`

## 3. Plan vs Implementation Matrix

Legend: Implemented / Partial / Not implemented

1. BEAST TCP ingress with backpressure and reconnect
- Status: Implemented
- Notes: Bounded queue and reconnect backoff present.

2. Single-writer ingest+tick architecture
- Status: Implemented (in-process)
- Notes: Implemented in `AdsbPoller`; not yet extracted into a separate registry domain/service.

3. Decode breadth (ADS-B + surveillance + Comm-B)
- Status: Partial
- Notes: Practical support exists; full parity validation and bit-level confidence framework are still missing.

4. CPR strategy (global + local tiers + sanity guards)
- Status: Implemented
- Notes: Global and local tiers plus teleport/heading guards are present.

5. Enrichment pattern (cache-only tick + async populate)
- Status: Implemented
- Notes: Operationally present for adsbdb/METAR and local datasets.

6. Extended enrichment ecosystem (photos, deeper route intelligence, richer joins)
- Status: Partial
- Notes: Core enrichments exist; photos and some deeper route/NAVAID heuristics from research are not complete.

7. Snapshot contract parity to research target
- Status: Partial
- Notes: Snapshot envelope and aircraft fields are solid, but still not full research wire-format parity.

8. State persistence add-ons (periodic registry snapshot, coverage heatmaps)
- Status: Not implemented

9. Frontend high-fidelity trail continuity behavior
- Status: Implemented
- Notes: Trail reset, ghosting, and bridge artifacts have concrete fixes in place.

## 4. Findings (Bugs / Risks)

Severity order: High -> Medium -> Low.

### High

1. BEAST `last_seen` semantics are incorrect for stale/freshness consumers.
- Evidence: `poller/normalizers/beast_decoder.py` sets `last_seen` from `datetime.now(...)` in `_to_entity`, not from `ac.last_seen_ts`.
- Impact: Downstream systems/readouts cannot distinguish message freshness vs snapshot serialization time; can mask stale contacts in consumers that rely on `last_seen`.
- Fix:
  - Emit true last-contact timestamp from `ac.last_seen_ts`.
  - Optionally add `snapshot_ts` separately for envelope serialization time.

2. HTTP ingest path can leave stale aircraft in snapshot cache when feed returns zero aircraft.
- Evidence: `poller/pollers/adsb.py` only publishes snapshot when `if aircraft:` in `_poll_ultrafeeder` and `_poll_opensky`.
- Impact: Last non-empty snapshot may persist in Redis and frontend, showing aircraft that are no longer present.
- Fix:
  - Always publish a snapshot per poll cycle, including empty list.
  - Include `source_status` metadata (`ok`, `empty`, `error`) for UI diagnostics.

### Medium

3. Change-only publish filter omits several BEAST-variant fields.
- Evidence: `poller/bus.py` `_entity_changed` compares a narrow key set and excludes fields like `trail_pts`, `position_stale`, `mlat_ticks`, `signal_peak`, `msg_count`, `comm_b`.
- Impact: `entity_update` stream consumers can miss meaningful aircraft state changes unless they also consume full snapshots.
- Fix:
  - Expand compare keys or use canonicalized hash over a curated schema.
  - Keep high-churn fields configurable (e.g., ignore or include by mode).

4. Fire-and-forget enrichment tasks are not tracked at poller level.
- Evidence: `asyncio.create_task(...)` calls in `poller/pollers/adsb.py` for route/aircraft/METAR misses.
- Impact: Error surfacing and lifecycle control are weaker; potential burst behavior under broad cache-miss scenarios.
- Fix:
  - Use a bounded enrichment work queue + worker pool.
  - Attach done callbacks or task-group style supervision.

5. Task lifecycle/shutdown control for spawned BEAST background tasks is implicit.
- Evidence: BEAST/worker/tick tasks are created from within poller but not explicitly canceled in poller teardown.
- Impact: Usually safe at full process shutdown, but brittle for controlled partial restarts or future hot-reload behavior.
- Fix:
  - Add explicit `close()` on poller class that cancels/joins spawned tasks.
  - Have `BasePoller.run()` invoke teardown in `finally`.

### Low

6. BEAST parser desync path does avoid blocking but still allocates copies during sync-seek.
- Evidence: `bytes(view[1:]).find(...)` in frame parser.
- Impact: Extra CPU/memory churn under noisy streams.
- Fix:
  - Replace with zero-copy scan over memoryview/bytearray index traversal.

7. Documentation drift and contradictions.
- Evidence:
  - Tracker says single-writer architecture is both implemented and “not yet implemented”.
  - `Last updated` in tracker is stale relative to recent BEAST fixes.
  - README says all entity positions are stored for 30-day history, while `ADSB_HISTORY_MODE=live_only` path exists.
- Impact: Engineering decisions made from docs can be wrong.
- Fix:
  - Update tracker and README for current behavior and optional modes.

## 5. Gaps vs Planning Document

1. Registry domain separation
- Gap: Single-writer is implemented inside `AdsbPoller`, not extracted as a reusable registry service boundary as envisioned.
- Improvement: Move registry/decode/tick orchestration into dedicated module with interface-based inputs/outputs.

2. Formal decode confidence framework
- Gap: Best-effort decode exists, but parity-validation harness against known-good datasets is missing.
- Improvement: Add fixture corpus and decoder regression suite (CRC edge cases, CPR edge cases, BDS decode examples).

3. Persistence/coverage layers
- Gap: No periodic registry persistence checkpoints and no coverage heatmap persistence for BEAST path.
- Improvement: Add periodic compact state snapshot and optional tile/grid counters.

4. Snapshot schema governance
- Gap: Contract evolves ad hoc; no explicit schema-versioning strategy.
- Improvement: Add `schema_version` to envelope and backward compatibility guard in frontend parser.

5. Observability depth
- Gap: Core counters are present (`frames`, `frames_dropped`) but no per-stage latency/queue-depth/exported metrics.
- Improvement: Export queue depth, decode throughput, snapshot build duration, reconnect counts, and enrichment hit/miss rates.

## 6. Recommended Remediation Plan

### Phase 0 (Immediate: 1-2 days) — ✅ Complete

1. ~~Fix `last_seen` correctness in BEAST entities.~~ ✅ Fixed 2026-04-30
2. ~~Always emit snapshots in HTTP mode, including empty lists.~~ ✅ Fixed 2026-04-30
3. ~~Update tracker/README docs to remove contradictions and stale claims.~~ ✅ Fixed 2026-04-30
4. ~~Add basic BEAST health fields in snapshot (`beast_connected`, `queue_depth`, `last_frame_age_s`).~~ ✅ Fixed 2026-04-30

### Phase 1 (Short term: 3-7 days) — ✅ Complete

1. ~~Refactor enrichment scheduling to bounded worker pool.~~ ✅ Fixed 2026-04-30 — bounded `_enrichment_queue` (maxsize=256) with supervised `_enrichment_worker_loop`; drops + closes coroutines when full
2. ~~Expand or formalize change-detection schema for `entity_update`.~~ ✅ Fixed 2026-04-30 — added `position_stale`, `signal_peak`, `msg_count`, `mlat_ticks`, `trail_pts`, `comm_b` to `_entity_changed()`
3. Add parser/decode unit tests for frame boundaries, CPR tiers, and Comm-B decoding.
4. ~~Add explicit task teardown in poller lifecycle.~~ ✅ Fixed 2026-04-30 — `AdsbPoller.close()` cancels all tasks; `BasePoller.run()` calls `close()` in finally block

### Phase 2 (Medium term: 1-2 weeks)

1. Extract registry domain module from poller transport concerns.
2. Introduce snapshot schema versioning and compatibility checks.
3. Add optional registry persistence checkpoints and replay hydration.

### Phase 3 (Longer term)

1. Implement remaining research enrichments (photo pipeline, deeper route intelligence).
2. Add coverage persistence and quality metrics dashboard.
3. Introduce synthetic BEAST replay for performance and regression testing.

## 7. Validation Checklist for Next Iteration

For each remediation PR:
- `cd frontend && npx tsc --noEmit`
- `docker compose config --quiet`
- `python3 -m py_compile <changed python files>`
- Runtime checks:
  - BEAST reconnect and snapshot continuity
  - Empty-feed behavior clears aircraft view
  - `last_seen` reflects true last message time
  - No task exception spam under forced enrichment upstream failure

## 8. Bottom Line

The BEAST ingress/rendering pipeline is already strong and functional. The biggest remaining work is not core capability, but correctness hardening, lifecycle supervision, schema governance, and documentation truthfulness. Addressing the high/medium items above will make the pipeline substantially more reliable and easier to evolve.
