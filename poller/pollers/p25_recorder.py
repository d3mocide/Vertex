"""
P25 audio recorder — captures per-call audio segments from the Icecast stream.

Subscribes to the civic:updates Redis channel for p25_call_start / p25_call_end
events. On call-start, opens a streaming download of the first enabled RadioStream
URL and writes chunks to /data/audio/{date}/{tgid}/{call_id}.mp3.
On call-end (or timeout), closes the file and persists a DB record.

Enable via P25_AUDIO_ENABLED=true in .env. Requires a RadioStream to be configured.
"""

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from bus import get_bus
from config import settings
from db import get_pool
from .base import BasePoller

logger = logging.getLogger(__name__)

_MAX_CALL_SECONDS = 300   # hard cap per recording (avoid runaway files)
_CHUNK_SIZE = 8192


class P25AudioRecorder(BasePoller):
    name = "p25_recorder"
    interval = 0  # event-driven

    def __init__(self):
        self._recording_task: asyncio.Task | None = None
        self._stop_event: asyncio.Event = asyncio.Event()
        self._stream_url: str | None = None

    async def setup(self):
        if not settings.p25_audio_enabled:
            return
        await self._refresh_stream_url()
        Path(settings.p25_audio_dir).mkdir(parents=True, exist_ok=True)

    async def _refresh_stream_url(self):
        try:
            row = await get_pool().fetchrow(
                "SELECT url FROM radio_streams WHERE enabled = TRUE ORDER BY id LIMIT 1"
            )
            self._stream_url = row["url"] if row else None
            if self._stream_url:
                logger.info("[p25_rec] will record from %s", self._stream_url)
            else:
                logger.info("[p25_rec] no enabled radio stream — recording inactive")
        except Exception as exc:
            logger.warning("[p25_rec] stream URL refresh failed: %s", exc)

    async def run(self) -> None:
        if not settings.p25_audio_enabled:
            logger.info("[p25_rec] audio recording disabled (P25_AUDIO_ENABLED not set)")
            return

        await self.setup()
        logger.info("[p25_rec] recorder started")
        r = await get_bus()
        pubsub = r.pubsub()
        await pubsub.subscribe("civic:updates")

        # Kick off daily retention cleanup
        cleanup_task = asyncio.create_task(self._cleanup_loop())

        try:
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    import json
                    msg = json.loads(message["data"])
                except Exception:
                    continue

                if msg.get("type") != "event":
                    continue
                event = msg.get("data") or {}
                etype = event.get("event_type", "")

                if etype == "p25_call_start":
                    await self._on_call_start(event)
                elif etype == "p25_call_end":
                    await self._on_call_end(event)

        except asyncio.CancelledError:
            pass
        finally:
            cleanup_task.cancel()
            if self._recording_task and not self._recording_task.done():
                self._stop_event.set()
                try:
                    await asyncio.wait_for(self._recording_task, timeout=5)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    pass
            await pubsub.unsubscribe("civic:updates")
            await pubsub.aclose()

    async def poll(self) -> None:
        pass

    async def _on_call_start(self, event: dict) -> None:
        if not self._stream_url:
            await self._refresh_stream_url()
        if not self._stream_url:
            return

        # Cancel any in-progress recording first
        if self._recording_task and not self._recording_task.done():
            self._stop_event.set()
            try:
                await asyncio.wait_for(self._recording_task, timeout=3)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass

        details = event.get("details") or {}
        call_id = event.get("event_id") or ""
        tgid = details.get("tgid") or 0
        tag = details.get("tag") or ""
        started_at = details.get("started_at") or datetime.now(timezone.utc).isoformat()

        self._stop_event.clear()
        self._recording_task = asyncio.create_task(
            self._record(call_id, tgid, tag, started_at)
        )

    async def _on_call_end(self, event: dict) -> None:
        if self._recording_task and not self._recording_task.done():
            if settings.p25_audio_delay_seconds > 0:
                # Delay stopping to catch the buffered tail of the stream.
                # If a new call starts during this delay, it will cancel this task correctly.
                async def _delayed_stop():
                    await asyncio.sleep(settings.p25_audio_delay_seconds)
                    self._stop_event.set()
                asyncio.create_task(_delayed_stop())
            else:
                self._stop_event.set()

    async def _record(self, call_id: str, tgid: int, tag: str, started_at_iso: str) -> None:
        if not self._stream_url:
            return

        if settings.p25_audio_delay_seconds > 0:
            await asyncio.sleep(settings.p25_audio_delay_seconds)

        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        out_dir = Path(settings.p25_audio_dir) / date_str / str(tgid)
        out_dir.mkdir(parents=True, exist_ok=True)
        file_path = out_dir / f"{call_id}.mp3"

        t_start = time.monotonic()
        bytes_written = 0

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5, read=None, write=5, pool=5)) as client:
                async with client.stream("GET", self._stream_url) as resp:
                    resp.raise_for_status()
                    with open(file_path, "wb") as fh:
                        async for chunk in resp.aiter_bytes(_CHUNK_SIZE):
                            if self._stop_event.is_set():
                                break
                            if time.monotonic() - t_start > _MAX_CALL_SECONDS:
                                logger.debug("[p25_rec] call %s hit max duration cap", call_id)
                                break
                            fh.write(chunk)
                            bytes_written += len(chunk)
        except Exception as exc:
            logger.debug("[p25_rec] recording error call=%s: %s", call_id, exc)

        duration_s = round(time.monotonic() - t_start, 1)
        ended_at = datetime.now(timezone.utc)

        if bytes_written < 1024:
            # Discard trivially empty files
            try:
                file_path.unlink(missing_ok=True)
            except Exception:
                pass
            logger.debug("[p25_rec] discarding empty recording call=%s", call_id)
            return

        try:
            await get_pool().execute(
                """
                INSERT INTO p25_recordings
                    (call_id, tgid, tag, file_path, started_at, ended_at, duration_s, file_size_bytes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT DO NOTHING
                """,
                call_id,
                tgid,
                tag,
                str(file_path),
                datetime.fromisoformat(started_at_iso.replace("Z", "+00:00")),
                ended_at,
                duration_s,
                bytes_written,
            )
            logger.info(
                "[p25_rec] saved call=%s tgid=%d dur=%.1fs size=%dB",
                call_id, tgid, duration_s, bytes_written,
            )
        except Exception as exc:
            logger.warning("[p25_rec] DB persist failed call=%s: %s", call_id, exc)

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(86400)  # once per day
            try:
                await self._purge_old_recordings()
            except Exception as exc:
                logger.warning("[p25_rec] cleanup error: %s", exc)

    async def _purge_old_recordings(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=settings.p25_audio_retention_days)
        try:
            rows = await get_pool().fetch(
                "SELECT id, file_path FROM p25_recordings WHERE started_at < $1", cutoff
            )
        except Exception as exc:
            logger.warning("[p25_rec] purge query failed: %s", exc)
            return

        for row in rows:
            try:
                Path(row["file_path"]).unlink(missing_ok=True)
            except Exception:
                pass

        if rows:
            ids = [r["id"] for r in rows]
            await get_pool().execute(
                "DELETE FROM p25_recordings WHERE id = ANY($1::int[])", ids
            )
            logger.info("[p25_rec] purged %d recordings older than %dd", len(rows), settings.p25_audio_retention_days)
