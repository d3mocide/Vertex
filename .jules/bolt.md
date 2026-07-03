## 2024-05-18 - Optimize dictionary comprehension lookups in exception handlers

**Learning:** Repeated fallback cache lookups (`_lookup.get_stale(icao)`) within multiple exception handlers can cause significant performance overhead during errors or rate-limiting events.
**Action:** When a method performs fallback dictionary iteration on failures, centralize the exception block to eliminate repetitive fallback logic, and implement a dedicated batch fallback method (`get_stale_many`) on the cache abstraction to perform direct, optimized attribute lookups (`self._entries.get`) instead of repetitive method invocations.

## 2024-07-03 - Optimize ADS-B Downlink Format checks to avoid string allocation
**Learning:** Checking the `Downlink Format (DF)` using an external library via a hex string (`pms.df(hex_msg)`) in the ADS-B poller `ingest` hot path creates massive string allocation overhead for irrelevant messages that are immediately discarded.
**Action:** Extract the DF directly from the leading raw byte using bitwise shifts (`message_bytes[0] >> 3`) and perform length validation on the byte array itself before any string allocation.
