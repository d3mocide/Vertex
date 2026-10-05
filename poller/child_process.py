"""Run CPU- or memory-heavy work in a throwaway child process.

Two things go wrong when this runs in the poller itself: a thread doing pure-Python work holds the GIL, so the
event loop starves and Redis reads blow past their 5 s socket timeout; and the transient heap (hundreds of MB for a
transit schedule) is never handed back by glibc once the work is done. A spawned child has neither problem: it frees
everything by exiting. `fn` must be a module-level function and its arguments and result picklable.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import multiprocessing


async def run_in_child(fn, *args):
    with concurrent.futures.ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn")) as pool:
        return await asyncio.get_running_loop().run_in_executor(pool, fn, *args)
