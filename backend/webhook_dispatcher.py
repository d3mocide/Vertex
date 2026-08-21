import asyncio
import json
import logging

import httpx
from sqlalchemy import select

from db.models import AlertRule
from db.session import async_session_factory
from redis_bus import subscribe_updates, get_redis
from security import validate_webhook_url_async

logger = logging.getLogger(__name__)

_SEVERITY_RANK = {
    "low": 1,
    "medium": 2,
    "high": 3,
    "critical": 4,
}


def _matches_rule(rule: AlertRule, event: dict) -> bool:
    if not rule.enabled:
        return False

    event_type = str(event.get("event_type") or "")
    severity = str(event.get("severity") or "low").lower()
    details = event.get("details") if isinstance(event.get("details"), dict) else {}
    rule_filter = rule.rule_filter or {}

    if rule.trigger_type == "scheduled":
        return False  # driven by sitrep_scheduler, not event stream

    if rule.trigger_type == "geofence_entry":
        if event_type != "geofence_entry":
            return False
        target_zone = rule_filter.get("zone_type")
        if target_zone and details.get("zone_type") != target_zone:
            return False
        return True

    if rule.trigger_type == "severity_threshold":
        min_sev = str(rule_filter.get("min_severity") or "high").lower()
        return _SEVERITY_RANK.get(severity, 1) >= _SEVERITY_RANK.get(min_sev, 3)

    if rule.trigger_type == "entity_type":
        want = str(rule_filter.get("entity_type") or "").strip().lower()
        if not want:
            return False
        return str(details.get("entity_type") or "").strip().lower() == want

    return False


async def _is_suppressed(rule: AlertRule, event: dict) -> bool:
    cooldown = rule.cooldown_seconds or 0
    max_per_hour = rule.max_per_hour or 0

    if not cooldown and not max_per_hour:
        return False

    r = get_redis()
    dedup_template = rule.dedup_key or ""
    if dedup_template:
        try:
            dedup_val = dedup_template.format(
                entity_id=str(event.get("entity_id") or ""),
                event_type=str(event.get("event_type") or ""),
            )
        except (KeyError, IndexError):
            dedup_val = event.get("entity_id") or event.get("event_id") or "all"
    else:
        dedup_val = event.get("entity_id") or event.get("event_id") or "all"

    base = f"alertrule:{rule.id}:{dedup_val}"

    if cooldown > 0 and await r.exists(f"{base}:cd"):
        return True

    if max_per_hour > 0:
        hour_key = f"{base}:h"
        count = await r.incr(hour_key)
        if count == 1:
            await r.expire(hour_key, 3600)
        if count > max_per_hour:
            return True

    if cooldown > 0:
        await r.set(f"{base}:cd", "1", ex=cooldown)

    return False


async def _dispatch_webhook(rule: AlertRule, event: dict) -> None:
    cfg = rule.action_config or {}
    url = cfg.get("url")
    if not url:
        return

    try:
        await validate_webhook_url_async(url)
    except ValueError as exc:
        logger.warning("[webhook] blocked unsafe URL rule=%s: %s", rule.id, exc)
        return

    headers = cfg.get("headers") if isinstance(cfg.get("headers"), dict) else {}
    timeout = min(float(cfg.get("timeout_s") or 10), 30.0)
    payload = {
        "rule": {
            "id": rule.id,
            "name": rule.name,
            "trigger_type": rule.trigger_type,
        },
        "event": event,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
        logger.info("[webhook] delivered rule=%s event=%s", rule.id, event.get("event_id"))
    except Exception as exc:
        logger.warning("[webhook] delivery failed rule=%s event=%s: %s", rule.id, event.get("event_id"), exc)


async def run_webhook_dispatcher() -> None:
    logger.info("[webhook] dispatcher started")
    backoff = 1
    while True:
        pubsub = None
        try:
            pubsub = await subscribe_updates()
            backoff = 1
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                raw = message.get("data")
                if not raw:
                    continue

                # ⚡ Bolt Optimization: Fast path bypasses json.loads for non-event messages.
                # Avoids massive event loop lag from parsing huge snapshots and high-frequency entity_updates.
                if isinstance(raw, bytes):
                    if b'"type": "event"' not in raw and b'"type":"event"' not in raw:
                        continue
                elif isinstance(raw, str):
                    if '"type": "event"' not in raw and '"type":"event"' not in raw:
                        continue

                try:
                    msg = json.loads(raw)
                except Exception:
                    continue

                if msg.get("type") != "event" or not isinstance(msg.get("data"), dict):
                    continue

                event = msg["data"]
                try:
                    async with async_session_factory() as db:
                        result = await db.execute(select(AlertRule).where(AlertRule.enabled == True))  # noqa: E712
                        rules = result.scalars().all()
                except Exception as exc:
                    logger.warning("[webhook] db error for event %s: %s", event.get("event_id"), exc)
                    continue

                for rule in rules:
                    if not _matches_rule(rule, event):
                        continue
                    if await _is_suppressed(rule, event):
                        logger.debug("[webhook] suppressed rule=%s event=%s (cooldown/rate)", rule.id, event.get("event_id"))
                        continue
                    if rule.action_type == "log":
                        logger.info("[webhook] log-rule matched id=%s event=%s", rule.id, event.get("event_id"))
                    else:
                        await _dispatch_webhook(rule, event)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("[webhook] dispatcher error, retrying in %ds: %s", backoff, exc)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)
        finally:
            if pubsub is not None:
                try:
                    await pubsub.unsubscribe("civic:updates")
                    await pubsub.aclose()
                except Exception:
                    pass
    logger.info("[webhook] dispatcher stopped")
