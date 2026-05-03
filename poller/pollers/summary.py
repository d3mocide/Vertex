import json
import logging
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

_MAX_TOKENS = 512
_SYSTEM = (
    "You are a Senior Situational Awareness Officer for a Regional Emergency Operations Center. "
    "Your task is to provide a high-fidelity, professional briefing based on real-time data feeds. "
    "Synthesize information across domains (Weather, Traffic, Utilities, Fire, News) to identify "
    "critical trends or compound risks. Be concise but thorough. Use professional terminology. "
    "Avoid preamble and sign-off."
)


class AISummaryPoller(BasePoller):
    name = "summary"
    interval = 300  # 5 minutes

    async def setup(self):
        if not settings.summary_llm_model:
            logger.warning("[summary] SUMMARY_LLM_MODEL not set — AI summaries disabled.")
        else:
            logger.info("[summary] AI summary using model: %s", settings.summary_llm_model)

    async def poll(self):
        if not settings.summary_llm_model:
            return

        r = await get_bus()
        context_parts: list[str] = []

        # 1. Weather
        raw = await r.get("feed:weather:alerts")
        if raw:
            alerts = json.loads(raw)
            if alerts:
                lines = [f"- {a.get('event', '')}: {a.get('headline', '')}" for a in alerts[:10]]
                context_parts.append("Weather Hazards:\n" + "\n".join(lines))

        # 2. Fire Activity
        raw = await r.get("feed:fire:incidents")
        if raw:
            fires = json.loads(raw)
            if fires:
                lines = [f"- {f.get('name', '')}: {f.get('location', '')} ({f.get('size_acres', 0)} acres)" for f in fires[:10]]
                context_parts.append("Wildfire/Fire Activity:\n" + "\n".join(lines))

        # 3. Traffic
        raw = await r.get("feed:traffic:incidents")
        if raw:
            incidents = json.loads(raw)
            if incidents:
                lines = [f"- {i.get('title', '')}: {i.get('description', '')[:250]}" for i in incidents[:10]]
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
                lines = [f"- {n.get('title', '')}" for n in items[:10]]
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
        logger.info("[summary] Updated high-fidelity situational summary via %s.", settings.summary_llm_model)
