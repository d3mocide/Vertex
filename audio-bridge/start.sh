#!/bin/sh
set -e

ICECAST_HOST="${ICECAST_HOST:-icecast}"
ICECAST_PORT="${ICECAST_PORT:-8000}"
ICECAST_PASSWORD="${ICECAST_SOURCE_PASSWORD:-hackme}"
ICECAST_MOUNT="${ICECAST_MOUNT:-radio.mp3}"
UDP_PORT="${UDP_AUDIO_PORT:-23456}"

echo "[audio-bridge] Waiting for first UDP packet on port ${UDP_PORT}..."
echo "[audio-bridge] Streaming to icecast://${ICECAST_HOST}:${ICECAST_PORT}/${ICECAST_MOUNT}"

# OP25 outputs raw signed 16-bit LE PCM at 8000 Hz mono via UDP.
# ffmpeg reads it, resamples to 44100, and pushes as MP3 to Icecast.
exec ffmpeg -hide_banner -loglevel warning \
    -f s16le -ar 8000 -ac 1 \
    -i "udp://0.0.0.0:${UDP_PORT}?timeout=10000000" \
    -c:a libmp3lame -b:a 64k -ar 44100 -ac 1 \
    -ice_name "Outpost - P25 Radio" \
    -f mp3 \
    "icecast://source:${ICECAST_PASSWORD}@${ICECAST_HOST}:${ICECAST_PORT}/${ICECAST_MOUNT}"
