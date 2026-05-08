import json
import logging
import time
from datetime import datetime, timezone

import litellm

from bus import get_bus, set_feed
from config import settings
from .base import BasePoller

import warnings

logger = logging.getLogger(__name__)
litellm.suppress_debug_info = True

# Suppress Pydantic serialization warnings from LiteLLM/Pydantic V2 mismatch
warnings.filterwarnings("ignore", category=UserWarning, message="Pydantic serializer warnings")

_MAX_TOKENS = 1536

_INJECTION_PATTERNS = ('###', 'SYSTEM:', '<|', '[INST]', '<<SYS>>')


def _sanitise(text: str, max_len: int = 300) -> str:
    for pat in _INJECTION_PATTERNS:
        text = text.replace(pat, '')
    return text[:max_len].strip()
# How often to run the check loop regardless of demand (fallback background refresh).
_BACKGROUND_INTERVAL_S = 3600  # 1 hour
# Minimum seconds between any two generations (rate-limit on-demand requests).
_MIN_REGEN_INTERVAL_S = 120
# Redis key set by the backend when the UI requests an immediate refresh.
_DEMAND_KEY = "summary:generate_now"
_SYSTEM = (
    "You are a Senior Situational Awareness Officer for a Regional Emergency Operations Center. "
    "Your task is to provide a high-fidelity, professional briefing based on real-time data feeds. "
    "Synthesize information across domains (Weather, Traffic, Utilities, Fire, News) to identify "
    "critical trends or compound risks. Be concise but thorough. Use professional terminology. "
    "Avoid preamble and sign-off."
)


class AISummaryPoller(BasePoller):
    name = "summary"
    # Check for the on-demand flag every 60 s; actual generation is gated by
    # _MIN_REGEN_INTERVAL_S (demand) or _BACKGROUND_INTERVAL_S (fallback).
    interval = 60

    def __init__(self):
        self._last_generated: float = 0.0

    async def setup(self):
        if not settings.summary_llm_model:
            logger.warning("[summary] SUMMARY_LLM_MODEL not set — AI summaries disabled.")
        else:
            logger.info("[summary] AI summary using model: %s (on-demand + %dh fallback)",
                        settings.summary_llm_model, _BACKGROUND_INTERVAL_S // 3600)

    async def poll(self):
        if not settings.summary_llm_model:
            return

        now = time.monotonic()
        elapsed = now - self._last_generated

        r = await get_bus()

        # Check whether the frontend has requested an on-demand refresh.
        demand_flag = await r.get(_DEMAND_KEY)
        if demand_flag:
            if elapsed < _MIN_REGEN_INTERVAL_S:
                # Too soon — acknowledge the flag but don't re-generate yet.
                logger.debug("[summary] on-demand flag set but within min interval (%.0fs), skipping", elapsed)
                return
            # Consume the flag before generating so a second request during
            # generation doesn't trigger a duplicate.
            await r.delete(_DEMAND_KEY)
            logger.info("[summary] on-demand refresh triggered")
        elif elapsed < _BACKGROUND_INTERVAL_S:
            # No demand flag and background interval not reached — skip this tick.
            return
        else:
            logger.info("[summary] background refresh (%.0f min since last)", elapsed / 60)

        await self._generate(r)

    async def _generate(self, r):
        """Read context from Redis, call the LLM, and write the result back."""
        context_parts: list[str] = []

        # 1. Weather
        raw = await r.get("feed:weather:alerts")
        if raw:
            alerts = json.loads(raw)
            if alerts:
                lines = [
                    f"- {_sanitise(a.get('event', ''))}: {_sanitise(a.get('headline', ''))}"
                    for a in alerts[:10]
                ]
                context_parts.append("Weather Hazards:\n" + "\n".join(lines))

        # 2. Fire Activity
        raw = await r.get("feed:fire:incidents")
        if raw:
            fires = json.loads(raw)
            if fires:
                lines = [
                    f"- {_sanitise(f.get('name', ''))}: {_sanitise(f.get('location', ''))} ({f.get('size_acres', 0)} acres)"
                    for f in fires[:10]
                ]
                context_parts.append("Wildfire/Fire Activity:\n" + "\n".join(lines))

        # 3. Traffic
        raw = await r.get("feed:traffic:incidents")
        if raw:
            incidents = json.loads(raw)
            if incidents:
                lines = [
                    f"- {_sanitise(i.get('title', ''))}: {_sanitise(i.get('description', ''), max_len=250)}"
                    for i in incidents[:10]
                ]
                context_parts.append("Traffic Impacts:\n" + "\n".join(lines))

        # 4. Utilities
        raw = await r.get("feed:utilities:status")
        if raw:
            util = json.loads(raw)
            if util.get('pge_affected', 0) > 0 or util.get('pacificorp_affected', 0) > 0:
                msg = f"- PGE Outages: {util.get('pge_affected')}\n- Pacific Power Outages: {util.get('pacificorp_affected')}"
                context_parts.append("Utility Status:\n" + msg)

        # 5. Regional News
        raw = await r.get("feed:news")
        if raw:
            items = json.loads(raw)
            if items:
                lines = [f"- {_sanitise(n.get('title', ''))}" for n in items[:10]]
                context_parts.append("Regional News Headlines:\n" + "\n".join(lines))

        if not context_parts:
            await set_feed("summary:latest", {
                "ts": datetime.now(timezone.utc).isoformat(),
                "summary": "No active alerts or incidents.",
                "model": "skipped",
            })
            return

        prompt = (
            "Based on the following data feeds, provide a professional situational awareness briefing "
            "synthesizing the current state of the region. Identify any compound risks where events in "
            "one domain might exacerbate another (e.g. weather impacting traffic/utilities).\n\n"
            + "\n\n".join(context_parts)
        )

        kwargs: dict = {
            "model": settings.summary_llm_model,
            "messages": [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": _MAX_TOKENS,
        }
        if settings.summary_llm_api_key:
            kwargs["api_key"] = settings.summary_llm_api_key
        if settings.summary_llm_api_base:
            kwargs["api_base"] = settings.summary_llm_api_base

        try:
            response = await litellm.acompletion(**kwargs)
            text = response.choices[0].message.content.strip()
        except Exception as exc:
            logger.warning("[summary] LLM call failed (%s): %s", settings.summary_llm_model, exc)
            return

        await set_feed("summary:latest", {
            "ts": datetime.now(timezone.utc).isoformat(),
            "summary": text,
            "model": settings.summary_llm_model,
        })
        self._last_generated = time.monotonic()
        logger.info("[summary] Updated high-fidelity situational summary via %s.", settings.summary_llm_model)
