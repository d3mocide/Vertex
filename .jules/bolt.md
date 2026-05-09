## 2024-05-09 - [Optimize Generator Expression in any()]
**Learning:** In tight loops (like poller services), avoid generator expressions within `any()`; unrolling them into a simple `for` loop with a boolean flag eliminates generator/frame overhead and is significantly faster in Python.
**Action:** When working on data-heavy loops in the `poller/` directory, replace `any(expr for item in iterable)` with explicit unrolled loops for noticeable speedups.
