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
