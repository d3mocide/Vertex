"""
P25 audio recorder — captures per-call audio to /data/audio/{date}/{tgid}/.

Two sources:

* OP25 audio websocket (P25_AUDIO_WS_URL, preferred). multi_rx streams the
  decoded voice as raw int16 mono PCM at 8 kHz in binary frames while a call
  is being decoded, and sends {"cmd": "audio_drain"} (or "audio_drop") when it
  ends. The audio itself marks call boundaries, so recordings start on the
  first word and are lossless WAV. The socket carries no talkgroup, so each
  segment is labelled with the nearest p25_call_start event from the P25
  poller (which reads OP25's :8080 status).
  Every frame is also relayed live (tagged with receiver and talkgroup) on
  Redis for the backend's /ws/radio listener.
* Icecast radio stream (fallback when P25_AUDIO_WS_URL is empty): on
  p25_call_start, stream the first enabled RadioStream to an .mp3 until
  p25_call_end. The stream runs seconds behind the events, so call starts
  are often clipped.

Enable via P25_AUDIO_ENABLED=true in .env.
"""

import asyncio
import json
import logging
import struct
import time
import uuid
import wave
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import websockets

from bus import get_bus
from config import settings
from db import get_pool
from .base import BasePoller

logger = logging.getLogger(__name__)

_MAX_CALL_SECONDS = 300   # hard cap per recording (avoid runaway files)
_CHUNK_SIZE = 8192

# OP25 websocket audio: int16 mono PCM at the vocoder rate.
_WS_RATE = 8000
_WS_GAP_S = 2.0          # no frames for this long ends a call (backup to audio_drain)
_WS_MIN_S = 0.5          # shorter segments are keying/noise, not speech
# How far a p25_call_start may be from the first audio frame and still label it:
# the poller reads OP25's status about once a second, so the event can lag.
_WS_MATCH_BEFORE_S = 10.0
_WS_MATCH_AFTER_S = 5.0

# Live listening: the backend's /ws/radio relays these Redis messages to the
# browser unchanged. Binary layout:
#   b"A" | receiver u8 | tgid u32 LE | int16 PCM   audio (tgid 0 = not known yet)
#   b"J" | UTF-8 JSON                              {"ev": "label"|"end", "ch": n, ...}
LIVE_CHANNEL = "p25:live"


class P25AudioRecorder(BasePoller):
    name = "p25_recorder"
    interval = 0  # event-driven

    def __init__(self):
        self._recording_task: asyncio.Task | None = None
        self._stop_event: asyncio.Event = asyncio.Event()
        self._stream_url: str | None = None
        # Recent p25_call_start events (websocket mode labels segments from these).
        self._recent_calls: deque[dict] = deque(maxlen=50)
        self._used_call_ids: deque[str] = deque(maxlen=200)
        self._save_tasks: set[asyncio.Task] = set()
        self._op25_url: str | None = None

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
        # One websocket per OP25 receiver (comma-separated), in multi_rx channel
        # order: with two receivers on one system, OP25 follows two calls at once.
        ws_urls = [u.strip() for u in settings.p25_audio_ws_url.split(",") if u.strip()]
        ws_mode = bool(ws_urls)
        ws_tasks = [asyncio.create_task(self._ws_loop(url, ch)) for ch, url in enumerate(ws_urls)]
        for ch, url in enumerate(ws_urls):
            logger.info("[p25_rec] recording OP25 receiver %d from websocket %s", ch, url)

        try:
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    msg = json.loads(message["data"])
                except Exception:
                    continue

                if msg.get("type") != "event":
                    continue
                event = msg.get("data") or {}
                etype = event.get("event_type", "")

                if ws_mode:
                    if etype == "p25_call_start":
                        self._remember_call(event)
                elif etype == "p25_call_start":
                    await self._on_call_start(event)
                elif etype == "p25_call_end":
                    await self._on_call_end(event)

        except asyncio.CancelledError:
            pass
        finally:
            cleanup_task.cancel()
            for task in ws_tasks:
                task.cancel()
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

    # ── Websocket mode ────────────────────────────────────────────────────

    def _remember_call(self, event: dict) -> None:
        details = event.get("details") or {}
        started = details.get("started_at") or event.get("ts")
        try:
            ts = datetime.fromisoformat(str(started).replace("Z", "+00:00")).timestamp()
        except Exception:
            ts = time.time()
        self._recent_calls.append({
            "id": event.get("event_id") or "", "tgid": details.get("tgid") or 0,
            "tag": details.get("tag") or "", "ts": ts,
        })

    def _nearest_call(self, seg_start: float) -> dict | None:
        best = None
        for c in self._recent_calls:
            dt = c["ts"] - seg_start
            if -_WS_MATCH_BEFORE_S <= dt <= _WS_MATCH_AFTER_S and (best is None or abs(dt) < abs(best["ts"] - seg_start)):
                best = c
        return best

    def _label_for(self, seg_start: float) -> tuple[str, int, str]:
        """(call_id, tgid, tag) from the call-start event nearest the segment start."""
        best = self._nearest_call(seg_start)
        if best is None:
            return str(uuid.uuid4()), 0, ""
        call_id = best["id"] or str(uuid.uuid4())
        # A call split by audio_drop / the length cap must not reuse the id.
        n = 2
        base = call_id
        while call_id in self._used_call_ids:
            call_id = f"{base}-{n}"
            n += 1
        self._used_call_ids.append(call_id)
        return call_id, int(best["tgid"] or 0), best["tag"]

    async def _ws_loop(self, url: str, channel: int = 0) -> None:
        """Keep a connection to one OP25 receiver's audio websocket and record each call."""
        backoff = 1.0
        while True:
            try:
                async with websockets.connect(url, max_size=None,
                                              open_timeout=10, ping_interval=20) as ws, self.streaming():
                    logger.info("[p25_rec] websocket connected (receiver %d)", channel)
                    backoff = 1.0
                    await self._ws_session(ws, channel)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[p25_rec] websocket error: %s — reconnecting in %.0fs", exc, backoff)
                await self._heartbeat("error", str(exc)[:256])
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)

    async def _op25_now(self, channel: int = 0) -> tuple[int, str] | None:
        """(tgid, tag) OP25 receiver `channel` is tuned to right now, from its :8080 status."""
        try:
            if self._op25_url is None:
                row = await get_pool().fetchrow(
                    "SELECT url FROM poller_sources WHERE type = 'p25' AND enabled = TRUE LIMIT 1")
                self._op25_url = row["url"] if row else ""
            if not self._op25_url:
                return None
            async with httpx.AsyncClient(timeout=2) as client:
                resp = await client.post(self._op25_url, json=[{"command": "update", "arg1": 0, "arg2": 0}])
            for msg in resp.json():
                if msg.get("json_type") == "channel_update":
                    ch = msg.get(str(channel)) or {}
                    if ch.get("tgid"):
                        return int(ch["tgid"]), ch.get("tag") or ""
        except Exception as exc:
            logger.debug("[p25_rec] OP25 status query failed: %s", exc)
        return None

    async def _ws_session(self, ws, channel: int = 0) -> None:
        pcm = bytearray()
        seg_start: float | None = None
        label: asyncio.Task | None = None
        live_tg = [0]                                        # talkgroup tagged on live frames
        while True:
            try:
                msg = await (asyncio.wait_for(ws.recv(), _WS_GAP_S) if seg_start is not None else ws.recv())
            except asyncio.TimeoutError:
                msg = None                                   # gap — the call is over
            if isinstance(msg, (bytes, bytearray)):
                if seg_start is None:
                    seg_start = time.time()
                    # OP25 is on the voice channel while audio flows: ask it
                    # which talkgroup (call-start events miss ~1 in 5 on WCN).
                    label = asyncio.create_task(self._op25_now(channel))
                    live_tg = [0]
                    label.add_done_callback(
                        lambda t, box=live_tg, s=seg_start: self._on_live_label(t, box, channel, s))
                pcm += msg
                await self._publish_live(b"A" + bytes([channel]) + struct.pack("<I", live_tg[0]) + bytes(msg))
                if len(pcm) >= _MAX_CALL_SECONDS * _WS_RATE * 2:
                    self._spawn_save(seg_start, bytes(pcm), label)
                    pcm.clear(); seg_start = None; label = None
                continue
            if isinstance(msg, str):
                try:
                    cmd = json.loads(msg).get("cmd")
                except Exception:
                    cmd = None
                if cmd not in ("audio_drain", "audio_drop"):
                    continue
            # End of call: audio_drain / audio_drop / gap.
            if seg_start is not None:
                self._spawn_save(seg_start, bytes(pcm), label)
                await self._publish_live(b"J" + json.dumps({"ev": "end", "ch": channel}).encode())
            pcm.clear(); seg_start = None; label = None

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._save_tasks.add(task)
        task.add_done_callback(self._save_tasks.discard)

    def _spawn_save(self, seg_start: float, pcm: bytes, label: asyncio.Task | None = None) -> None:
        # Saving waits for a lagging call-start label; don't stall the receive loop.
        self._spawn(self._save_segment(seg_start, pcm, label))

    async def _publish_live(self, payload: bytes) -> None:
        """Relay to live listeners. Best effort: never let it disturb recording."""
        try:
            await (await get_bus()).publish(LIVE_CHANNEL, payload)
        except Exception as exc:
            logger.debug("[p25_rec] live publish failed: %s", exc)

    def _on_live_label(self, task: asyncio.Task, box: list[int], channel: int, seg_start: float) -> None:
        """Tag the call's live frames once OP25 says which talkgroup it is."""
        live = None if task.cancelled() or task.exception() else task.result()

        async def _apply(tgid: int, tag: str) -> None:
            box[0] = tgid
            await self._publish_live(b"J" + json.dumps(
                {"ev": "label", "ch": channel, "tgid": tgid, "tag": tag}).encode())

        async def _from_event() -> None:
            # OP25 didn't answer: use the call-start event once it has arrived.
            await asyncio.sleep(1.0)
            best = self._nearest_call(seg_start)
            if best and best["tgid"] and not box[0]:
                await _apply(int(best["tgid"]), best["tag"])

        self._spawn(_apply(*live) if live else _from_event())

    async def _save_segment(self, seg_start: float, pcm: bytes, label: asyncio.Task | None = None) -> None:
        duration_s = round(len(pcm) / 2 / _WS_RATE, 1)
        if duration_s < _WS_MIN_S:
            return
        # Give a lagging call-start event a moment to arrive before labelling.
        await asyncio.sleep(1.0)
        call_id, tgid, tag = self._label_for(seg_start)
        live = None
        if label is not None:
            try:
                live = await label
            except Exception:
                live = None
        if live and live[0] != tgid:
            # OP25's own answer at audio start beats the nearest event.
            tgid, tag = live
            if call_id in self._used_call_ids:
                call_id = str(uuid.uuid4())
        started = datetime.fromtimestamp(seg_start, timezone.utc)
        out_dir = Path(settings.p25_audio_dir) / started.strftime("%Y-%m-%d") / str(tgid)
        file_path = out_dir / f"{call_id}.wav"

        def _write() -> None:
            out_dir.mkdir(parents=True, exist_ok=True)
            with wave.open(str(file_path), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(_WS_RATE)
                w.writeframes(pcm)
        try:
            await asyncio.to_thread(_write)
            await get_pool().execute(
                """
                INSERT INTO p25_recordings
                    (call_id, tgid, tag, file_path, started_at, ended_at, duration_s, file_size_bytes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT DO NOTHING
                """,
                call_id, tgid, tag, str(file_path), started,
                started + timedelta(seconds=duration_s), duration_s, file_path.stat().st_size,
            )
            logger.info("[p25_rec] saved call=%s tgid=%d dur=%.1fs (websocket)", call_id, tgid, duration_s)
        except Exception as exc:
            logger.warning("[p25_rec] save failed call=%s: %s", call_id, exc)

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
