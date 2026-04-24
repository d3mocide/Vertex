import json
import logging
from datetime import datetime, timezone

import anthropic

from bus import get_bus, set_feed
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 256
_SYSTEM = (
    "You are a situational awareness assistant for a local emergency operations center. "
    "Write concise, factual summaries in plain language. Be direct — no preamble, no sign-off."
)


class AISummaryPoller(BasePoller):
    name = "summary"
    interval = 300  # 5 minutes

    async def setup(self):
        if not settings.anthropic_api_key:
            logger.warning("[summary] ANTHROPIC_API_KEY not set — AI summaries disabled.")

    async def poll(self):
        if not settings.anthropic_api_key:
            return

        r = await get_bus()
        context_parts: list[str] = []

        raw = await r.get("feed:weather:alerts")
        if raw:
            alerts = json.loads(raw)
            if alerts:
                lines = [f"- {a.get('event', '')}: {a.get('headline', '')}" for a in alerts[:5]]
                context_parts.append("Active NWS weather alerts:\n" + "\n".join(lines))

        raw = await r.get("feed:alerts:flash")
        if raw:
            items = json.loads(raw)
            if items:
                lines = [f"- {i.get('title', '')}: {i.get('summary', '')[:120]}" for i in items[:5]]
                context_parts.append("Emergency alerts:\n" + "\n".join(lines))

        raw = await r.get("feed:traffic:incidents")
        if raw:
            incidents = json.loads(raw)
            if incidents:
                lines = [f"- {i.get('title', '')}: {i.get('description', '')[:100]}" for i in incidents[:5]]
                context_parts.append("Traffic incidents:\n" + "\n".join(lines))

        if not context_parts:
            await set_feed("summary:latest", {
                "ts": datetime.now(timezone.utc).isoformat(),
                "summary": "No active alerts or incidents.",
                "model": "skipped",
            })
            return

        prompt = (
            "Based on the following current data feeds, write a 2-3 sentence "
            "plain-language situational awareness summary. Focus on what matters most.\n\n"
            + "\n\n".join(context_parts)
        )

        try:
            client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
            message = await client.messages.create(
                model=_MODEL,
                max_tokens=_MAX_TOKENS,
                system=_SYSTEM,
                messages=[{"role": "user", "content": prompt}],
            )
            text = message.content[0].text.strip()
        except Exception as exc:
            logger.warning("[summary] Anthropic API call failed: %s", exc)
            return

        await set_feed("summary:latest", {
            "ts": datetime.now(timezone.utc).isoformat(),
            "summary": text,
            "model": _MODEL,
        })
        logger.info("[summary] Updated situational summary.")
