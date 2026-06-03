## 2024-05-18 - Optimize dictionary comprehension lookups in exception handlers

**Learning:** Repeated fallback cache lookups (`_lookup.get_stale(icao)`) within multiple exception handlers can cause significant performance overhead during errors or rate-limiting events.
**Action:** When a method performs fallback dictionary iteration on failures, centralize the exception block to eliminate repetitive fallback logic, and implement a dedicated batch fallback method (`get_stale_many`) on the cache abstraction to perform direct, optimized attribute lookups (`self._entries.get`) instead of repetitive method invocations.
