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
        # 1. Weather Alerts (NWS/FlashAlert)
        raw = await r.get("feed:weather:alerts")
        if raw:
            alerts = json.loads(raw)
            if alerts:
                lines = [f"- {a.get('event')}: {a.get('headline')}" for a in alerts[:10]]
                context_parts.append("WEATHER HAZARDS:\n" + "\n".join(lines))
            else:
                context_parts.append("WEATHER STATUS: No active NWS advisories or emergency alerts.")
        else:
            context_parts.append("WEATHER STATUS: Data feed currently unavailable.")

        # 2a. Fire Incident Tracker (EONET entities — same data the UI fire card shows)
        fire_entities: list[dict] = []
        for key in await r.keys("entity:fire:*"):
            ent_raw = await r.get(key)
            if not ent_raw:
                continue
            try:
                ent = json.loads(ent_raw)
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(ent, dict):
                fire_entities.append(ent)
        if fire_entities:
            # Local (alert radius) fires first, then by distance.
            fire_entities.sort(key=lambda e: (
                (e.get("identity") or {}).get("relevance") != "local",
                e.get("distance_km") or 0,
            ))
            lines = []
            for ent in fire_entities[:10]:
                relevance = (ent.get("identity") or {}).get("relevance")
                tag = "ALERT (local radius)" if relevance == "local" else "WATCH (regional smoke source)"
                name = _sanitise(str(ent.get("display_name") or "Wildfire"), 120)
                dist = ent.get("distance_km")
                dist_text = f"{round(dist)} km" if isinstance(dist, (int, float)) else "distance unknown"
                updated = ent.get("last_seen") or "update time unknown"
                lines.append(f"- {tag}: {name} — {dist_text}, last update {updated}")
            context_parts.append("WILDFIRE INCIDENT TRACKER:\n" + "\n".join(lines))
        else:
            context_parts.append(
                "WILDFIRE INCIDENT TRACKER: No wildfire incidents inside the local alert or regional watch radius."
            )

        # 2b. Smoke / Air Quality (AirNow via weather feed)
        raw = await r.get("feed:weather:current")
        if raw:
            wx = json.loads(raw)
            aqi = wx.get("aqi") if isinstance(wx, dict) else None
            if aqi is not None:
                label = wx.get("aqi_label") or "Unknown"
                context_parts.append(f"SMOKE / AIR QUALITY: AQI {aqi} ({label}).")

        # 2c. Fire Perimeters (NIFC mapped polygons)
        raw = await r.get("feed:fire:perimeters")
        if raw:
            payload = json.loads(raw)
            fires = payload.get("features", []) if isinstance(payload, dict) else (payload or [])
            if isinstance(fires, list) and fires:
                lines = []
                for f in fires[:10]:
                    props = f.get("properties", {}) if isinstance(f, dict) else {}
                    name = props.get("name") or "Wildfire"
                    state = props.get("state") or "Unknown"
                    acres = props.get("acres")
                    acres_text = f"{acres} acres" if acres is not None else "acreage unknown"
                    lines.append(f"- {name}: {state} ({acres_text})")
                context_parts.append("MAPPED FIRE PERIMETERS (NIFC):\n" + "\n".join(lines))
            else:
                context_parts.append(
                    "MAPPED FIRE PERIMETERS (NIFC): Confirmed zero mapped perimeters in the regional query area."
                )
        else:
            context_parts.append(
                "MAPPED FIRE PERIMETERS (NIFC): Perimeter feed has not synced; rely on the incident tracker above for fire status."
            )

        # 3. Traffic Impacts (ODOT/Real-time)
        raw = await r.get("feed:traffic:incidents")
        if raw:
            incidents = json.loads(raw)
            if incidents:
                lines = [f"- {i.get('title')}: {i.get('description')[:200]}" for i in incidents[:10]]
                context_parts.append("TRAFFIC IMPACTS:\n" + "\n".join(lines))
            else:
                context_parts.append("TRAFFIC STATUS: No significant incidents reported.")
        else:
            context_parts.append("TRAFFIC STATUS: Data feed currently unavailable.")

        # 4. Utility Status (PGE/Pacificorp)
        pge_raw = await r.get("feed:utility:pge")
        ore_raw = await r.get("feed:utility:oregon")
        util_msg = []
        if pge_raw:
            pge = json.loads(pge_raw)
            if pge.get('affected', 0) > 100:
                util_msg.append(f"- PGE Outages: {pge.get('affected')} customers affected.")
        if ore_raw:
            ore = json.loads(ore_raw)
            if ore.get('pacificorp_affected', 0) > 100:
                util_msg.append(f"- Pacificorp Outages: {ore.get('pacificorp_affected')} customers affected.")
        
        if util_msg:
            context_parts.append("UTILITY STATUS:\n" + "\n".join(util_msg))
        else:
            context_parts.append("UTILITY STATUS: No major power outages reported (>100 cust).")

        # 5. Priority Intelligence (OSINT Elevated News)
        raw = await r.get("feed:intel:alerts")
        if raw:
            intel = json.loads(raw)
            if intel:
                lines = [f"- PRIORITY: {n.get('title')} ({n.get('source')})" for n in intel[:5]]
                context_parts.append("TACTICAL INTEL ALERTS (HIGH PRIORITY):\n" + "\n".join(lines))

        # 6. Regional News
        raw = await r.get("feed:news:local")
        if raw:
            items = json.loads(raw)
            if items:
                lines = [f"- {n.get('title')}" for n in items[:15]]
                context_parts.append("REGIONAL HEADLINES:\n" + "\n".join(lines))

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
