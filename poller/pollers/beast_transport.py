"""BeastTransport — TCP ingestion and frame parsing for the BEAST protocol.

Handles the network concerns of the BEAST pipeline:
  - TCP connection with exponential reconnect/backoff
  - 0x1A escape-sequence frame boundary detection and unescape
  - MLAT timestamp and RSSI signal byte extraction
  - Delivery of (message_bytes, mlat_ticks, signal) tuples via callback

Intentionally free of Mode S decode logic; does not import pyModeS.
All decode decisions are delegated upstream to BeastAircraftDecoder.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable

from config import settings
from security import validate_safe_host

logger = logging.getLogger(__name__)

# BEAST frame type -> Mode S payload length in bytes.
# 0x31 = 2-byte short squitter (skipped), 0x32 = 7-byte short, 0x33 = 14-byte long.
_PAYLOAD_LEN = {0x31: 2, 0x32: 7, 0x33: 14}


class BeastTransport:
    """Manages a BEAST TCP connection and delivers raw Mode S frames.

    Usage::

        def on_frame(msg: bytes, mlat_ticks: int, signal: int) -> None:
            ...  # enqueue for decode

        transport = BeastTransport(on_frame=on_frame)
        task = asyncio.create_task(transport.run())
        # later:
        task.cancel()
        await task

    Public attributes (read-only for the caller):
        frames_seen:    Total frames successfully parsed and delivered.
        last_frame_ts:  Unix timestamp of the most recently delivered frame
                        (0.0 if no frame has been seen yet).
        is_healthy:     True when TCP is connected and a frame has arrived
                        within adsb_beast_stale_threshold_seconds.
    """

    def __init__(self, *, on_frame: Callable[[bytes, int, int], None]):
        self._on_frame = on_frame
        self.frames_seen: int = 0
        self.last_frame_ts: float = 0.0
        self._connected: bool = False

    @property
    def is_healthy(self) -> bool:
        """TCP is up and frames are arriving within the configured stale window."""
        if not self._connected or self.last_frame_ts == 0.0:
            return False
        return (time.time() - self.last_frame_ts) < settings.adsb_beast_stale_threshold_seconds

    async def run(self) -> None:
        """Connect to the BEAST TCP endpoint and stream frames indefinitely.

        Reconnects with exponential backoff on any connection error.
        Raise ``asyncio.CancelledError`` to stop (cancelling the task is safe).
        """
        backoff = max(1, settings.adsb_beast_reconnect_initial_seconds)
        max_backoff = max(backoff, settings.adsb_beast_reconnect_max_seconds)
        host = settings.adsb_beast_host
        port = settings.adsb_beast_port

        while True:
            writer = None
            try:
                await validate_safe_host(host)
                reader, writer = await asyncio.open_connection(host, port)
                self._connected = True
                logger.info("[beast] connected to %s:%s", host, port)
                backoff = max(1, settings.adsb_beast_reconnect_initial_seconds)
                buffer = bytearray()

                while True:
                    chunk = await reader.read(4096)
                    if not chunk:
                        raise ConnectionError("BEAST stream closed")
                    buffer.extend(chunk)
                    consumed, messages = self.consume_buffer(buffer)
                    if consumed:
                        del buffer[:consumed]
                    if messages:
                        self.frames_seen += len(messages)
                        self.last_frame_ts = time.time()
                        for msg, mlat_ticks, signal in messages:
                            self._on_frame(msg, mlat_ticks, signal)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._connected = False
                logger.warning("[beast] connection error: %s (retry in %ss)", exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, max_backoff)
            finally:
                self._connected = False
                try:
                    if writer is not None:
                        writer.close()
                        await writer.wait_closed()
                except Exception:
                    pass

    def consume_buffer(
        self, buffer: bytearray
    ) -> tuple[int, list[tuple[bytes, int, int]]]:
        """Parse as many complete BEAST frames as possible from *buffer*.

        Returns ``(consumed_byte_count, [(message, mlat_ticks, signal), ...])``.
        The caller must delete the first *consumed_byte_count* bytes from the
        buffer after this call.
        """
        pos = 0
        blen = len(buffer)
        messages: list[tuple[bytes, int, int]] = []

        while pos < blen:
            # Fast path: a frame whose wire body contains no 0x1A byte needs no
            # unescaping, so it can be sliced out directly at C speed. This is
            # the overwhelmingly common case (0x1A appears in ~0.4% of body
            # bytes), and it avoids the per-byte Python loop in parse_frame().
            if buffer[pos] == 0x1A and pos + 1 < blen:
                payload_len = _PAYLOAD_LEN.get(buffer[pos + 1])
                if payload_len is not None:
                    body_start = pos + 2
                    body_end = body_start + 7 + payload_len
                    if body_end <= blen and buffer.find(0x1A, body_start, body_end) == -1:
                        if buffer[pos + 1] != 0x31:  # 0x31 short squitter: skip
                            messages.append((
                                bytes(buffer[body_start + 7:body_end]),
                                int.from_bytes(buffer[body_start:body_start + 6], "big"),
                                buffer[body_start + 6],
                            ))
                        pos = body_end
                        continue

            # Slow path: escapes present, buffer incomplete, or garbage bytes.
            consumed, message = self.parse_frame(memoryview(buffer)[pos:])
            if consumed == 0:
                break          # incomplete frame; wait for more data
            if consumed < 0:
                pos += abs(consumed)
                continue       # skipped garbage bytes
            pos += consumed
            if message:
                messages.append(message)

        return pos, messages

    def parse_frame(
        self, view: memoryview
    ) -> tuple[int, tuple[bytes, int, int] | None]:
        """Parse a single BEAST frame from the start of *view*.

        BEAST wire format::

            0x1A  <type>  [6B MLAT big-endian]  [1B signal]  [N bytes Mode S]

        Any 0x1A byte inside the body is escaped as 0x1A 0x1A on the wire.
        Frame types:  0x31 = 2-byte short squitter (skipped),
                      0x32 = 7-byte Mode S short,
                      0x33 = 14-byte Mode S long (DF17/DF18).

        Returns:
            ``(N, (message, mlat_ticks, signal))`` — N bytes consumed, valid frame.
            ``(N, None)``  — N bytes consumed, frame skipped (0x31 type).
            ``(0, None)``  — buffer incomplete; wait for more data.
            ``(-N, None)`` — N garbage bytes skipped before the next sync marker.
        """
        if len(view) < 2:
            return 0, None
        if view[0] != 0x1A:
            next_sync = bytes(view[1:]).find(b"\x1a")
            if next_sync < 0:
                return -len(view), None
            return -(next_sync + 1), None

        frame_type = view[1]
        payload_len = _PAYLOAD_LEN.get(frame_type)
        if payload_len is None:
            return -1, None

        needed = 6 + 1 + payload_len
        i = 2
        filled = 0
        body = bytearray(needed)

        while filled < needed:
            if i >= len(view):
                return 0, None
            b = view[i]
            if b == 0x1A:
                if i + 1 >= len(view):
                    return 0, None
                if view[i + 1] == 0x1A:
                    body[filled] = 0x1A
                    i += 2
                    filled += 1
                else:
                    return -i, None
            else:
                body[filled] = b
                i += 1
                filled += 1

        if frame_type not in (0x32, 0x33):
            return i, None

        mlat_ticks = int.from_bytes(body[0:6], byteorder="big", signed=False)
        signal = int(body[6])
        message = bytes(body[7 : 7 + payload_len])
        return i, (message, mlat_ticks, signal)
