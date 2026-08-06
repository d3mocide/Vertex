"""
Scheduled SitRep delivery — background task that fires SitRep generation
on an operator-configured interval and delivers the result to a webhook URL.

AlertRule records with action_type="sitrep_delivery" drive the schedule.
action_config fields:
  interval_hours  int   (required) — how often to fire, e.g. 6
  hours_window    int   (optional, default 24) — SitRep time window passed to generator
  url             str   (optional) — webhook URL to POST the SitRep to
"""
import asyncio
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from db.models import AlertRule
from db.session import async_session_factory
from redis_bus import get_redis
from security import validate_webhook_url_async

logger = logging.getLogger(__name__)

_REDIS_PREFIX = "sitrep_sched"


async def _last_run(redis, rule_id: int) -> float:
    raw = await redis.get(f"{_REDIS_PREFIX}:{rule_id}:last_run")
    return float(raw) if raw else 0.0


async def _mark_run(redis, rule_id: int) -> None:
    await redis.set(f"{_REDIS_PREFIX}:{rule_id}:last_run", str(datetime.now(timezone.utc).timestamp()))


async def _generate_and_deliver(rule: AlertRule) -> None:
    cfg = rule.action_config or {}
    hours_window = int(cfg.get("hours_window") or 24)
    delivery_url = cfg.get("url") or ""

    # Generate SitRep markdown inline (avoid HTTP round-trip to self)
    from routers.sitrep import generate_sitrep
    # Use a fresh DB session and Redis directly
    async with async_session_factory() as db:
        redis = get_redis()

        class _FakeRequest:
            pass

        # Call the generation logic directly
        md_response = await generate_sitrep(hours=hours_window, db=db, redis=redis)

    md_text = md_response.body.decode() if hasattr(md_response, "body") else str(md_response)

    if delivery_url:
        try:
            await validate_webhook_url_async(delivery_url)
        except ValueError as exc:
            logger.warning("[sitrep_sched] blocked unsafe delivery URL rule=%s: %s", rule.id, exc)
            return

        headers = cfg.get("headers") if isinstance(cfg.get("headers"), dict) else {}
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    delivery_url,
                    content=md_text.encode(),
                    headers={"Content-Type": "text/markdown", **headers},
                )
                resp.raise_for_status()
            logger.info("[sitrep_sched] delivered rule=%s to %s", rule.id, delivery_url)
        except Exception as exc:
            logger.warning("[sitrep_sched] delivery failed rule=%s: %s", rule.id, exc)
    else:
        logger.info("[sitrep_sched] rule=%s fired (no delivery URL — log only)", rule.id)


async def run_sitrep_scheduler() -> None:
    logger.info("[sitrep_sched] scheduler started")
    while True:
        try:
            await asyncio.sleep(60)  # check every minute
            redis = get_redis()
            now_ts = datetime.now(timezone.utc).timestamp()

            async with async_session_factory() as db:
                result = await db.execute(
                    select(AlertRule).where(
                        AlertRule.enabled == True,  # noqa: E712
                        AlertRule.action_type == "sitrep_delivery",
                    )
                )
                rules = result.scalars().all()

            for rule in rules:
                cfg = rule.action_config or {}
                interval_hours = int(cfg.get("interval_hours") or 0)
                if interval_hours <= 0:
                    continue
                interval_s = interval_hours * 3600
                last = await _last_run(redis, rule.id)
                if now_ts - last >= interval_s:
                    await _mark_run(redis, rule.id)
                    logger.info(
                        "[sitrep_sched] triggering rule=%s interval=%dh",
                        rule.id, interval_hours,
                    )
                    try:
                        await _generate_and_deliver(rule)
                    except Exception as exc:
                        logger.warning("[sitrep_sched] rule=%s error: %s", rule.id, exc)

        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("[sitrep_sched] scheduler error: %s", exc)

    logger.info("[sitrep_sched] scheduler stopped")
