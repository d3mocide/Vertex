## 2024-05-09 - [Optimize Generator Expression in any()]
**Learning:** In tight loops (like poller services), avoid generator expressions within `any()`; unrolling them into a simple `for` loop with a boolean flag eliminates generator/frame overhead and is significantly faster in Python.
**Action:** When working on data-heavy loops in the `poller/` directory, replace `any(expr for item in iterable)` with explicit unrolled loops for noticeable speedups.
## 2026-05-10 - [Optimize str.startswith with tuples instead of any(generator)]\n**Learning:** In hot paths (like AuthMiddleware parsing every request),  is measurably slower than passing a tuple directly: . The generator creates overhead that can be bypassed by leveraging the native C implementation of .\n**Action:** Use tuples directly with  instead of looping or generator expressions when checking multiple prefixes.
## 2024-05-10 - [Optimize str.startswith with tuples instead of any(generator)]
**Learning:** In hot paths (like AuthMiddleware parsing every request), `any(path.startswith(prefix) for prefix in prefixes)` is measurably slower than passing a tuple directly: `path.startswith(prefixes)`. The generator creates overhead that can be bypassed by leveraging the native C implementation of `startswith`.
**Action:** Use tuples directly with `startswith` instead of looping or generator expressions when checking multiple string prefixes.
## 2024-05-13 - [Hoist redundant datetime calls in geofence loop]
**Learning:** In `poller/geofence.py`, calling `datetime.now(timezone.utc)` repeatedly inside a dictionary iteration generator expression (or tight loop) adds measurable overhead for no benefit since the execution happens within the same frame.
**Action:** Always hoist variables that remain constant during execution (like the current time) outside of loops and list comprehensions.
## 2024-05-22 - [Optimize Generator Expression in all()]
**Learning:** Similar to `any()`, unrolling `all()` generator expressions in hot paths (like `poller/normalizers/beast_decoder.py`) avoids generator/frame overhead and can be ~2-20x faster depending on how early it exits.
**Action:** Unroll `all()` into explicit loops with early returns when optimizing high-frequency parsing/decoding code.
## 2026-05-10 - [Optimize JSON parsing with fast string match]
**Learning:** In high-throughput async Python components (like ADSB poller sync looping over thousands of Redis keys), calling `json.loads(raw)` on every single entity when you only care about a specific type is extremely slow. We can use fast string matching (`b'"entity_type": "aircraft"' in raw`) to bypass parsing for non-matching entities. Note that `raw` from Redis might be `bytes` or `str` so check appropriately.
**Action:** When looping over large datasets where only a subset of JSON objects are relevant, use fast matching on the raw payload to filter out non-matching entities before calling `json.loads()`.
