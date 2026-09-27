"""
Whisper P25 transcription service.

Watches P25_AUDIO_DIR for new audio files written by OP25, transcribes each
call with faster-whisper, updates the p25_recordings row in Postgres, and
publishes a p25_transcript event to Redis so the frontend updates live.

On startup it also back-fills any existing recordings that have no
transcription yet, so recordings accumlated while the service was offline
are picked up automatically.
"""

import asyncio
import io
import json
import logging
import re
import time
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path

import asyncpg
import litellm
import redis.asyncio as aioredis
from faster_whisper import WhisperModel

from config import settings

litellm.suppress_debug_info = True

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("transcription")

AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".m4a"}
# Files transcribed per scan before rescanning for newer calls.
_BATCH = 3

# Cap retries so a file that can never transcribe (e.g. a squelch-noise-only
# clip, or a remote STT node that consistently errors on it) doesn't get
# resent to the STT endpoint forever — one attempt every scan cycle, with no
# backoff or limit, turns into a permanent flood against the remote host.
_MAX_ATTEMPTS = 3
_RETRY_BACKOFF_BASE = 30.0  # seconds; doubles per attempt (30s, 60s, ...)


def _pg_url(url: str) -> str:
    """Strip SQLAlchemy async driver prefix so asyncpg accepts the URL."""
    return url.replace("postgresql+asyncpg://", "postgresql://")



# Voice band-pass, silence trim at both ends, loudness normalisation.
_CLEAN_FILTER = (
    "highpass=f=250,lowpass=f=3600,"
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.2,areverse,"
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.3,areverse,"
    "loudnorm=I=-18:TP=-2:LRA=11"
)


async def _preprocess(path: Path) -> bytes | None:
    """Cleaned 16 kHz mono WAV of `path`, or None to fall back to the raw file."""
    try:
        # Raw PCM out, WAV header written here: ffmpeg writing WAV to a pipe
        # cannot seek back to fill in the sizes and leaves them 0xFFFFFFFF.
        # The Whisper server can't decode that and answers with its previous
        # transcript instead of an error — every call got the same text.
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-loglevel", "error", "-i", str(path), "-af", _CLEAN_FILTER,
            "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        pcm, err = await asyncio.wait_for(proc.communicate(), timeout=30)
    except Exception as exc:
        logger.warning("[transcription] preprocess failed for %s: %s", path.name, exc)
        return None
    if proc.returncode != 0:
        logger.warning("[transcription] preprocess failed for %s: %s", path.name, err.decode(errors="replace")[:200])
        return None
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm)
    return buf.getvalue()

class TranscriptionService:
    def __init__(self) -> None:
        self._model: WhisperModel | None = None
        self._pool: asyncpg.Pool | None = None
        self._redis: aioredis.Redis | None = None
        # Tracks files already processed (or in-progress) within this run.
        self._processed: set[str] = set()
        # Last remote transcript, to catch the server repeating a stale result.
        self._last_remote_text: str = ""
        # Failed-attempt bookkeeping so a permanently-failing file backs off
        # and is eventually given up on instead of retried every scan cycle.
        self._attempts: dict[str, int] = {}
        self._next_attempt: dict[str, float] = {}

    async def start(self) -> None:
        if settings.whisper_remote_model:
            logger.info(
                "[transcription] using remote STT model=%s api_base=%s",
                settings.whisper_remote_model,
                settings.whisper_remote_api_base or "(provider default)",
            )
        else:
            logger.info(
                "[transcription] loading local model=%s device=%s compute_type=%s",
                settings.whisper_model,
                settings.whisper_device,
                settings.whisper_compute_type,
            )
            # WhisperModel constructor is synchronous and may download the model
            # on first run — run it in a thread so it doesn't block the event loop.
            self._model = await asyncio.to_thread(
                WhisperModel,
                settings.whisper_model,
                device=settings.whisper_device,
                compute_type=settings.whisper_compute_type,
                cpu_threads=settings.whisper_cpu_threads,
            )
            logger.info("[transcription] model ready")

        self._pool = await asyncpg.create_pool(
            _pg_url(settings.database_url), min_size=1, max_size=3
        )
        self._redis = await aioredis.from_url(
            settings.redis_url, decode_responses=True
        )

        # Seed the processed set from already-transcribed rows so we never
        # re-process files that were handled in a previous run.
        rows = await self._pool.fetch(
            "SELECT file_path FROM p25_recordings WHERE transcription IS NOT NULL"
        )
        self._processed = {r["file_path"] for r in rows}
        logger.info(
            "[transcription] %d previously-transcribed files seeded", len(self._processed)
        )

        # No blocking backfill: the watch loop finds untranscribed files itself,
        # newest first, so a backlog never delays live calls.
        await self._watch_loop()

    async def _watch_loop(self) -> None:
        audio_path = Path(settings.p25_audio_dir)
        audio_path.mkdir(parents=True, exist_ok=True)
        logger.info(
            "[transcription] watching %s every %.1fs", audio_path, settings.scan_interval
        )

        while True:
            try:
                now = time.monotonic()
                # Recorder output is nested by date/TGID; recurse so new files are discovered.
                candidates = [
                    f
                    for f in audio_path.rglob("*")
                    if f.is_file()
                    and f.suffix.lower() in AUDIO_EXTS
                    and str(f) not in self._processed
                    and self._next_attempt.get(str(f), 0.0) <= now
                ]
                # Newest first, a few at a time, rescanning in between: a live
                # call is transcribed within seconds even while a backlog (e.g.
                # a re-transcription) is being worked through.
                candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                for f in candidates[:_BATCH]:
                    await self._process(f)
                if len(candidates) > _BATCH:
                    continue                      # more waiting: rescan now, no sleep
            except Exception as exc:
                logger.error("[transcription] watch error: %s", exc)
            await asyncio.sleep(settings.scan_interval)

    async def _process(self, path: Path) -> None:
        # Stability check: wait for the file size to stop changing before
        # assuming OP25 has finished writing the segment.
        try:
            size_a = path.stat().st_size
            await asyncio.sleep(2.0)
            size_b = path.stat().st_size
            if size_b == 0 or size_b != size_a:
                return
        except FileNotFoundError:
            return

        # Claim the file before any async gaps to prevent double-processing.
        self._processed.add(str(path))

        try:
            logger.info("[transcription] transcribing %s", path.name)
            t0 = time.monotonic()

            text = await self._transcribe(path)
            elapsed = time.monotonic() - t0
            logger.info(
                "[transcription] %s → %d chars in %.1fs", path.name, len(text), elapsed
            )

            await self._persist(path, text)
            self._attempts.pop(str(path), None)
            self._next_attempt.pop(str(path), None)

        except Exception as exc:
            attempts = self._attempts.get(str(path), 0) + 1
            self._attempts[str(path)] = attempts

            if attempts >= _MAX_ATTEMPTS:
                logger.error(
                    "[transcription] giving up on %s after %d failed attempts (last error: %s)",
                    path.name, attempts, exc,
                )
                # Persist an empty transcription so this file is never
                # reconsidered (by this run's backfill or a future restart).
                try:
                    await self._persist(path, "")
                except Exception as persist_exc:
                    logger.error(
                        "[transcription] failed to mark %s as given up: %s",
                        path.name, persist_exc,
                    )
                self._attempts.pop(str(path), None)
                self._next_attempt.pop(str(path), None)
            else:
                logger.error(
                    "[transcription] failed %s (attempt %d/%d): %s",
                    path.name, attempts, _MAX_ATTEMPTS, exc,
                )
                # Release the claim so a later scan cycle retries, after a
                # backoff that grows with each failed attempt.
                self._processed.discard(str(path))
                self._next_attempt[str(path)] = (
                    time.monotonic() + _RETRY_BACKOFF_BASE * (2 ** (attempts - 1))
                )

    async def _transcribe(self, path: Path) -> str:
        lang = settings.whisper_language if settings.whisper_language != "auto" else None

        if settings.whisper_remote_model:
            name, audio_bytes = path.name, None
            if settings.whisper_preprocess:
                audio_bytes = await _preprocess(path)
                if audio_bytes is not None:
                    # Under ~0.3 s left after trimming silence: no speech. Don't
                    # send it — the shared Whisper server answered near-empty
                    # audio with another client's transcript (a NOAA forecast).
                    if len(audio_bytes) - 44 < 0.3 * 16000 * 2:
                        return ""
                    name = path.stem + ".wav"
            if audio_bytes is None:
                audio_bytes = await asyncio.to_thread(path.read_bytes)
            response = await litellm.atranscription(
                model=settings.whisper_remote_model,
                file=(name, audio_bytes),
                language=lang,
                api_base=settings.whisper_remote_api_base or None,
                api_key=settings.whisper_remote_api_key or None,
            )
            text = (response.text or "").strip()
            # The server answers audio it can't decode with its previous
            # transcript. The same non-trivial text for two different calls in
            # a row is that failure, not speech — drop it rather than store it.
            if len(text) > 15 and text == self._last_remote_text:
                logger.warning("[transcription] %s: repeat of the previous transcript — treating as no speech", path.name)
                return ""
            self._last_remote_text = text
            return text

        segments, _info = await asyncio.to_thread(
            self._model.transcribe,  # type: ignore[union-attr]
            str(path),
            language=lang,
            beam_size=5,
        )
        return " ".join(seg.text for seg in segments).strip()

    async def _persist(self, path: Path, text: str) -> None:
        rec = await self._pool.fetchrow(
            "SELECT id, tgid, tag FROM p25_recordings WHERE file_path = $1",
            str(path),
        )

        tgid: int | None = None
        tag: str = ""

        if rec:
            await self._pool.execute(
                "UPDATE p25_recordings SET transcription = $1 WHERE id = $2",
                text,
                rec["id"],
            )
            tgid = rec["tgid"]
            tag = rec["tag"] or ""
        else:
            # File exists on disk but was never registered in p25_recordings
            # (e.g. OP25 wrote it before the backend started). Parse what we
            # can from the filename and create a minimal row.
            tgid, tag = _parse_filename(path.name)
            if tgid:
                await self._pool.execute(
                    """
                    INSERT INTO p25_recordings
                        (call_id, tgid, tag, file_path, started_at, transcription)
                    VALUES ($1, $2, $3, $4, NOW(), $5)
                    ON CONFLICT DO NOTHING
                    """,
                    path.stem,
                    tgid,
                    tag,
                    str(path),
                    text,
                )

        await self._publish(tgid, tag, text, path.name)

    async def _publish(
        self, tgid: int | None, tag: str, text: str, filename: str
    ) -> None:
        event = {
            "type": "event",
            "data": {
                "event_id":   str(uuid.uuid4()),
                "event_type": "p25_transcript",
                "ts":         datetime.now(timezone.utc).isoformat(),
                "severity":   "info",
                "summary":    f"Transcript TGID {tgid} — {tag}",
                "details": {
                    "tgid":       tgid,
                    "tag":        tag,
                    "transcript": text,
                    "file":       filename,
                },
            },
        }
        await self._redis.publish("civic:updates", json.dumps(event))  # type: ignore[union-attr]


def _parse_filename(name: str) -> tuple[int | None, str]:
    """
    Extract TGID from common OP25 filename patterns:
      YYYYMMDD_HHMMSS_TGID.wav   (e.g. 20240512_143022_9001.wav)
      tgid_NNNNN_*.wav
    Returns (tgid, tag); tag is always empty since the filename carries no label.
    """
    m = re.search(r"_(\d{4,9})(?:\.\w+)?$", name)
    if m:
        return int(m.group(1)), ""
    m = re.match(r"(?:tgid_)?(\d{4,9})", name)
    if m:
        return int(m.group(1)), ""
    return None, ""


async def main() -> None:
    service = TranscriptionService()
    await service.start()


if __name__ == "__main__":
    asyncio.run(main())
