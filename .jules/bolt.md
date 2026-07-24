## 2024-05-18 - Optimize dictionary comprehension lookups in exception handlers

**Learning:** Repeated fallback cache lookups (`_lookup.get_stale(icao)`) within multiple exception handlers can cause significant performance overhead during errors or rate-limiting events.
**Action:** When a method performs fallback dictionary iteration on failures, centralize the exception block to eliminate repetitive fallback logic, and implement a dedicated batch fallback method (`get_stale_many`) on the cache abstraction to perform direct, optimized attribute lookups (`self._entries.get`) instead of repetitive method invocations.
## 2025-02-14 - Avoid lambda closures in high-throughput parsing loops

**Learning:** Creating lambda functions inline (e.g. `self._safe(lambda: pms.adsb.typecode(hex_msg))`) within high-frequency parsing paths like ADSB decoding adds unnecessary closure creation overhead per call, which becomes a measurable bottleneck given thousands of messages.
**Action:** Unroll closures by modifying wrapper functions to accept arguments (`*args, **kwargs`) and pass the function reference directly (`self._safe(pms.adsb.typecode, hex_msg)`), eliminating the dynamic closure overhead per frame.
