#!/bin/sh
# Writes /tmp/runtime-config.js from the container's VITE_* environment so one prebuilt image serves every install's
# .env. nginx serves it at /runtime-config.js and src/config.ts reads it before falling back to build-time values.
# The root filesystem is read-only, so it lives on the /tmp tmpfs. Only the names below are exported: everything in
# this file is public to any browser that loads the app, so never add a secret here.
set -eu

out=/tmp/runtime-config.js
tmp="$out.$$"

json_escape() {
  # Backslash and double quote are escaped; control characters (including newlines) are dropped.
  printf '%s' "$1" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

{
  printf 'window.__VERTEX_CONFIG__ = {'
  sep=''
  for name in VITE_RADAR_LAYER VITE_RADAR_FALLBACK_LAYER VITE_RADAR_FALLBACK_MAX_ZOOM VITE_OBSERVATION_RANGE_KM \
              VITE_MESH_NODE_STALE_HOURS VITE_TILE_URL VITE_PRESERVE_DRAWING_BUFFER VITE_RADIO_STREAM_URL; do
    eval "value=\${$name-}"
    [ -n "$value" ] || continue
    printf '%s"%s":"%s"' "$sep" "$name" "$(json_escape "$value")"
    sep=','
  done
  printf '}\n'
} > "$tmp"
mv "$tmp" "$out"
echo "40-vertex-runtime-config: wrote $out"
