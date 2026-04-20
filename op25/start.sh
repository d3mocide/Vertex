#!/bin/bash
set -e

# Sync user-supplied config into the app directory
if [ -d /op25-config ]; then
    cp -f /op25-config/*.tsv /op25/op25/apps/ 2>/dev/null || true
    cp -f /op25-config/*.json /op25/op25/apps/ 2>/dev/null || true
fi

cd /op25/op25/apps

exec python3 multi_rx.py \
    -S "${P25_SAMPLE_RATE:-2400000}" \
    -q "${P25_PPM:-0}" \
    -g "${P25_GAIN:-40}" \
    -2 \
    -x 1 \
    -V \
    -U "${UDP_AUDIO_HOST:-audio-bridge}:${UDP_AUDIO_PORT:-23456}" \
    -w \
    -T trunk.tsv \
    2>&1
