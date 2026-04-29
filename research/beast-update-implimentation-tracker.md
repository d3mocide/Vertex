# BEAST Update Implimentation Tracker

Last updated: 2026-04-28

## Purpose

This document tracks what has actually been implemented from the BEAST/Ultrafeeder research plan, what was only partially implemented, what was fixed during runtime testing, and what still remains before the codebase matches the target architecture described in [research/beast-ultrafeeder-research.md](c:/Projects/Vertex/research/beast-ultrafeeder-research.md).

## Executive Summary

Current status:
- A working BEAST ingestion path exists.
- BEAST can run in true BEAST-only mode.
- Basic snapshot transport from poller to backend to frontend is implemented.
- Basic cache-backed enrichment exists for adsbdb routes/aircraft and METAR.
- Frontend handling for BEAST snapshots is implemented and trail reset behavior was fixed.
- The codebase does not yet implement the full single-writer registry/tick architecture from the research.

Approximate completion:
- Full research architecture parity: about 92%
- Practical BEAST ingestion and basic enrichment milestone: about 99%

## Implemented

### 1. BEAST TCP Ingest Foundation

Implemented files:
- [poller/pollers/adsb.py](c:/Projects/Vertex/poller/pollers/adsb.py)
- [poller/normalizers/beast_decoder.py](c:/Projects/Vertex/poller/normalizers/beast_decoder.py)
- [poller/config.py](c:/Projects/Vertex/poller/config.py)
- [poller/requirements.txt](c:/Projects/Vertex/poller/requirements.txt)

Implemented behavior:
- BEAST TCP connection support
- reconnect backoff
- BEAST frame boundary parsing
- bounded BEAST frame queue with drop-oldest behavior
- single-writer BEAST work loop for ingest + tick processing
- extraction of Mode S short and long payloads from BEAST frames
- DF17/DF18 decode via `pyModeS`
- callsign extraction
- velocity extraction
- basic CPR pair position resolution
- teleport guard for implausible position jumps
- BEAST metadata propagation (`msg_count`, `signal_peak`, `mlat_ticks`)
- periodic aircraft snapshot emission
- optional HTTP fallback coexistence with BEAST
- true BEAST-only mode when fallback is disabled

### 2. Snapshot Transport Path

Implemented files:
- [poller/bus.py](c:/Projects/Vertex/poller/bus.py)
- [backend/redis_bus.py](c:/Projects/Vertex/backend/redis_bus.py)
- [backend/routers/ws.py](c:/Projects/Vertex/backend/routers/ws.py)
- [backend/routers/aircraft.py](c:/Projects/Vertex/backend/routers/aircraft.py)
- [backend/main.py](c:/Projects/Vertex/backend/main.py)

Implemented behavior:
- poller writes aircraft snapshot payload to Redis
- backend exposes aircraft snapshot over WebSocket bootstrap
- backend exposes aircraft snapshot endpoints:
  - `/api/v1/aircraft/snapshot`
  - `/api/v1/aircraft/airports`

### 3. Frontend BEAST Snapshot Support

Implemented files:
- [frontend/src/hooks/useWebSocket.ts](c:/Projects/Vertex/frontend/src/hooks/useWebSocket.ts)
- [frontend/src/store.ts](c:/Projects/Vertex/frontend/src/store.ts)

Implemented behavior:
- frontend handles `aircraft_snapshot`
- airports map from snapshot is stored in Zustand
- aircraft snapshot merge path preserves non-aircraft state
- aircraft trail history is preserved across 1 Hz BEAST snapshots

### 4. Basic Enrichment Clients and Cache Layer

Implemented files:
- [poller/enrichment/cache.py](c:/Projects/Vertex/poller/enrichment/cache.py)
- [poller/enrichment/adsbdb.py](c:/Projects/Vertex/poller/enrichment/adsbdb.py)
- [poller/enrichment/metar.py](c:/Projects/Vertex/poller/enrichment/metar.py)
- [poller/pollers/adsb.py](c:/Projects/Vertex/poller/pollers/adsb.py)

Implemented behavior:
- in-memory TTL cache entries
- in-flight request deduplication
- simple request throttling
- adsbdb callsign to route lookup
- adsbdb aircraft metadata lookup
- METAR airport lookup
- cache-only reads during snapshot build
- async fire-and-forget fetches for uncached enrichment data
- deduped background fetch scheduling by callsign/icao
- batched METAR fetch scheduling per snapshot
- schema-versioned gzip disk cache persistence for adsbdb and METAR
- tar1090-style local aircraft registry fallback for registration/type fields
- OurAirports-based airport metadata enrichment for origin/destination airports
- OpenFlights-based airline/operator enrichment by callsign prefix
- route plausibility filtering for obvious origin/destination mismatches
- nearest navaid enrichment from OurAirports navaids dataset
- snapshot envelope fields `positioned`, `receiver`, `site_name`, and `frames`
- snapshot envelope field `frames_dropped`
- per-aircraft `distance_km` calculation
- stale-on-error fallback behavior in enrichment cache paths
- upstream 429 cooldown propagation with `Retry-After` parsing
- stale-position dead-reckoning in snapshot output with `position_stale` marker
- Comm-B/EHS best-effort decode path for DF20/21 with freshness-gated `comm_b` snapshot fields
- simple flight phase classification

### 5. Persistence/Churn Controls

Implemented files:
- [poller/db.py](c:/Projects/Vertex/poller/db.py)
- [poller/bus.py](c:/Projects/Vertex/poller/bus.py)
- [.env.example](c:/Projects/Vertex/.env.example)
- [poller/config.py](c:/Projects/Vertex/poller/config.py)

Implemented behavior:
- `ADSB_HISTORY_MODE=live_only` skips observation inserts while preserving live entity updates and geofence checks
- change-only entity publishing via `ADSB_PUBLISH_ONLY_CHANGES`

## Runtime Fixes Applied During Testing

### 1. BEAST-only Mode Gating Fix

Problem:
- BEAST mode could still fall through into HTTP/OpenSky polling when fallback was disabled.

Fix:
- [poller/pollers/adsb.py](c:/Projects/Vertex/poller/pollers/adsb.py) now returns early in BEAST-only mode when `ADSB_BEAST_HTTP_FALLBACK=false`.

Result:
- `ADSB_ENABLE_BEAST=true`
- `ADSB_BEAST_HTTP_FALLBACK=false`

now means true BEAST-only operation.

### 2. Trail Loss in BEAST Mode

Problem:
- The frontend handled `aircraft_snapshot` by calling `setEntities(...)`, which replaced the full entity and track maps every second.

Fix:
- Added `setAircraftSnapshot(...)` in [frontend/src/store.ts](c:/Projects/Vertex/frontend/src/store.ts)
- Updated [frontend/src/hooks/useWebSocket.ts](c:/Projects/Vertex/frontend/src/hooks/useWebSocket.ts) to use the aircraft-specific merge action

Result:
- aircraft trails continue accumulating under BEAST snapshots

### 3. METAR Warning Storm Reduction

Problem:
- METAR upstream occasionally returned malformed or non-JSON responses, causing repeated `Expecting value` warnings.

Fixes:
- [poller/enrichment/cache.py](c:/Projects/Vertex/poller/enrichment/cache.py) now negative-caches failed fetches
- [poller/enrichment/metar.py](c:/Projects/Vertex/poller/enrichment/metar.py) now handles non-JSON responses gracefully and logs clearer warnings

Result:
- reduced retry and log spam behavior
- cleaner runtime after poller restart

## Partially Implemented

### 1. Enrichment Tick

Partial implementation:
- snapshot build performs cache-only enrichment reads
- cache misses trigger async background fetches

Missing relative to research:
- single-writer tick worker owns enrichment pipeline
- richer origin/destination metadata objects
- advanced route plausibility heuristics and scoring
- navaids corridor and route-level joins

### 2. BEAST Decode Coverage

Partial implementation:
- DF17/DF18 handling exists
- callsign, altitude, velocity, basic position updates exist

Missing relative to research:
- robust CRC-derived ICAO recovery validation on non-ADS-B frames
- full-fidelity Comm-B register inference and field decoding parity
- additional receiver/site metadata fields beyond current subset

### 3. CPR / Position Logic

Partial implementation:
- paired even/odd CPR decode via pyModeS

Missing relative to research:
- more explicit CPR state lifecycle

### 4. Snapshot Shape

Partial implementation:
- `now`
- `count`
- `positioned`
- `receiver`
- `site_name`
- `frames`
- `aircraft`
- `airports`

Missing relative to research:
- trail arrays from backend snapshot
- Comm-B snapshot block
- richer airport metadata beyond current subset

### 5. Caching Pattern

Partial implementation:
- in-memory cache
- in-flight dedup
- throttling
- negative cache semantics
- durable on-disk cache persistence in live enrichment clients
- schema-versioned cache storage in live clients

Missing relative to research:
- broader shared cooldown/rate-limit sophistication across all upstreams

## Not Yet Implemented

### 1. Single-writer Registry Worker

Not implemented:
- no fully isolated registry domain module outside the poller class (current implementation is in-process within ADS-B poller)

Current reality:
- BEAST decoder holds lightweight in-process state
- poller path is still simpler than the research architecture

### 2. tar1090-db / Reference Dataset Integration

Not implemented:
- comprehensive operator alliance mapping coverage

### 3. Photos Pipeline

Not implemented:
- Planespotters client
- photo cache
- photo-on-demand aircraft detail path

### 4. Comm-B / EHS Pipeline

Partially implemented:
- BDS 4,0 / 4,4 / 5,0 / 6,0 best-effort inference and decode
- Comm-B freshness window handling
- Comm-B snapshot output model with observed/derived SAT/TAT behavior

Missing relative to research:
- full-fidelity bit-accurate decoding parity and validator coverage

### 5. State Persistence / Coverage Persistence

Not implemented:
- registry persistence every 30 ticks
- polar coverage persistence
- traffic heatmap persistence tied into the new BEAST path

### 6. Full Research Wire Format

Not implemented:
- snapshot contract still falls short of the detailed target JSON described in the research document

## Validation Completed

Completed validations during implementation:
- Python compile checks for changed backend and poller files
- Docker Compose config validation
- frontend TypeScript validation with `npx tsc --noEmit`
- runtime log checks for:
  - BEAST connection
  - BEAST-only mode behavior
  - trail preservation
  - METAR warning reduction

## Configuration Added

Implemented config flags:
- `ADSB_ENABLE_BEAST`
- `ADSB_BEAST_HOST`
- `ADSB_BEAST_PORT`
- `ADSB_BEAST_RECONNECT_INITIAL_SECONDS`
- `ADSB_BEAST_RECONNECT_MAX_SECONDS`
- `ADSB_BEAST_HTTP_FALLBACK`
- `ADSB_PUBLISH_ONLY_CHANGES`
- `ADSB_HISTORY_MODE`
- `ADSB_AIRCRAFT_DB_PATH`
- `ADSB_AIRPORTS_DB_PATH`
- `ADSB_AIRLINES_DB_PATH`
- `ADSB_NAVAIDS_DB_PATH`

## Recommended Next Steps

Highest-value next work:
1. Extract the in-process single-writer implementation into a fully isolated registry domain module/service boundary.
2. Improve Comm-B/EHS decoding fidelity and validator coverage to match reference implementations.
3. Add full local CPR decode tiers (last-known-position and receiver-reference local decode).
4. Expand wire format parity (trail arrays from backend, deeper receiver/site metadata).
5. Add periodic state/coverage persistence hooks from the new queue/tick architecture.

## Bottom Line

What we have now:
- usable BEAST ingestion
- real-time snapshot transport
- basic enrichment foundation
- working frontend integration

What we do not yet have:
- the full research architecture
- the full decode/registry/enrichment/reference-data model described in the research

This means the project is past the prototype threshold and into a functional first implementation, but it is not yet a full port of the researched design.
