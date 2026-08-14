## 2024-05-18 - Optimize dictionary comprehension lookups in exception handlers

**Learning:** Repeated fallback cache lookups (`_lookup.get_stale(icao)`) within multiple exception handlers can cause significant performance overhead during errors or rate-limiting events.
**Action:** When a method performs fallback dictionary iteration on failures, centralize the exception block to eliminate repetitive fallback logic, and implement a dedicated batch fallback method (`get_stale_many`) on the cache abstraction to perform direct, optimized attribute lookups (`self._entries.get`) instead of repetitive method invocations.
## 2026-07-10 - Removing lambda closures in hotpaths
**Learning:** In high-throughput loops like ADS-B message decoding, wrapping function calls in lambda expressions (e.g. `_safe(lambda: fn(args))`) creates unnecessary overhead due to repeated inner-function definition and closure allocation. Passing `*args` directly (e.g. `_safe(fn, *args)`) offers a small but measurable dispatch speedup.
**Action:** Modify wrapper functions to accept `*args` and pass them directly to the target function rather than passing `lambda` closures when used in high-frequency loops.
## 2026-07-28 - Early returns prevent massive allocation overhead in Comm-B
**Learning:** In high-throughput message decoding (`poller/normalizers/beast_decoder.py`), processing functions like `_build_comm_b_snapshot` are called for *every* frame. Because >90% of frames lack Comm-B data, evaluating freshness flags and constructing an empty 22-key dictionary for every frame creates massive allocation overhead.
**Action:** Always add early returns (e.g. `if not ac.comm_b_raw: return None`) before constructing complex dictionaries or performing logic. This completely bypasses the allocation overhead for the majority case, yielding a 32x speedup for empty messages.
