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
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import asyncpg
import redis.asyncio as aioredis
from faster_whisper import WhisperModel

from config import settings

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("transcription")

AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".m4a"}


def _pg_url(url: str) -> str:
    """Strip SQLAlchemy async driver prefix so asyncpg accepts the URL."""
    return url.replace("postgresql+asyncpg://", "postgresql://")


class TranscriptionService:
    def __init__(self) -> None:
        self._model: WhisperModel | None = None
        self._pool: asyncpg.Pool | None = None
        self._redis: aioredis.Redis | None = None
        # Tracks files already processed (or in-progress) within this run.
        self._processed: set[str] = set()

    async def start(self) -> None:
        logger.info(
            "[transcription] loading model=%s device=%s compute_type=%s",
            settings.whisper_model,
            settings.whisper_device,
            settings.whisper_compute_type,
        )
        # WhisperModel constructor is synchronous and may download the model on
        # first run — run it in a thread so it doesn't block the event loop.
        self._model = await asyncio.to_thread(
            WhisperModel,
            settings.whisper_model,
            device=settings.whisper_device,
            compute_type=settings.whisper_compute_type,
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

        await self._backfill()
        await self._watch_loop()

    async def _backfill(self) -> None:
        """Transcribe recordings that exist in DB but have no transcription."""
        rows = await self._pool.fetch(
            "SELECT file_path FROM p25_recordings WHERE transcription IS NULL"
        )
        if not rows:
            return
        logger.info("[transcription] backfilling %d unprocessed recordings", len(rows))
        for row in rows:
            path = Path(row["file_path"])
            if path.is_file() and str(path) not in self._processed:
                await self._process(path)

    async def _watch_loop(self) -> None:
        audio_path = Path(settings.p25_audio_dir)
        audio_path.mkdir(parents=True, exist_ok=True)
        logger.info(
            "[transcription] watching %s every %.1fs", audio_path, settings.scan_interval
        )

        while True:
            try:
                # Recorder output is nested by date/TGID; recurse so new files are discovered.
                candidates = [
                    f
                    for f in audio_path.rglob("*")
                    if f.is_file()
                    and f.suffix.lower() in AUDIO_EXTS
                    and str(f) not in self._processed
                ]
                # Process oldest files first so the log stays chronological.
                for f in sorted(candidates, key=lambda p: p.stat().st_mtime):
                    await self._process(f)
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

            lang = settings.whisper_language if settings.whisper_language != "auto" else None
            segments, _info = await asyncio.to_thread(
                self._model.transcribe,  # type: ignore[union-attr]
                str(path),
                language=lang,
                beam_size=5,
            )
            text = " ".join(seg.text for seg in segments).strip()
            elapsed = time.monotonic() - t0
            logger.info(
                "[transcription] %s → %d chars in %.1fs", path.name, len(text), elapsed
            )

            await self._persist(path, text)

        except Exception as exc:
            logger.error("[transcription] failed %s: %s", path.name, exc)
            # Release the claim so the next scan cycle retries.
            self._processed.discard(str(path))

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
