export const API_BASE = '/api/v1'

export const WS_URL =
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

// Map style — override with VITE_TILE_URL for offline/self-hosted tiles.
// When VITE_TILE_URL is set it should point to a tileserver-gl style endpoint,
// e.g. http://localhost:8080/styles/basic-preview/style.json
const _rawOfflineTileUrl = (import.meta.env.VITE_TILE_URL as string | undefined)?.trim()
const _invalidOfflineTileUrl = Boolean(
  _rawOfflineTileUrl && /\{z\}|\{x\}|\{y\}/i.test(_rawOfflineTileUrl)
)

if (_invalidOfflineTileUrl) {
  console.warn(
    'Ignoring VITE_TILE_URL because it looks like a raster tile template. Provide a MapLibre style URL such as http://localhost:8080/styles/basic-preview/style.json.'
  )
}

const _offlineTileUrl = _invalidOfflineTileUrl ? '' : (_rawOfflineTileUrl ?? '')
export const MAP_STYLE = _offlineTileUrl || 'https://tiles.openfreemap.org/styles/dark'
export const OFFLINE_TILES = Boolean(_offlineTileUrl)
export const PRESERVE_DRAWING_BUFFER = (import.meta.env.VITE_PRESERVE_DRAWING_BUFFER || 'false') === 'true'



// Default view: Tualatin, OR
export const DEFAULT_CENTER: [number, number] = [
  Number(import.meta.env.VITE_REGION_LON ?? -122.7635),
  Number(import.meta.env.VITE_REGION_LAT ?? 45.3842),
]
export const DEFAULT_ZOOM = 10

// Audio stream — stream URL is sourced from the radio_streams DB table.
// This env var is an escape hatch for a default fallback; leave empty if all streams are DB-configured.
export const STREAM_URL = (import.meta.env.VITE_RADIO_STREAM_URL as string | undefined)?.trim() ?? ''

// Polling intervals (ms)
export const HEALTH_POLL_MS   = 15_000
export const ALERTS_POLL_MS   = 2 * 60_000   // 2 min (WS is primary)
export const NEWS_POLL_MS     = 5 * 60_000   // 5 min (WS is primary)
export const WEATHER_POLL_MS  = 10 * 60_000  // 10 min (WS is primary)
export const CAMERAS_POLL_MS  = 10 * 60_000  // 10 min (WS is primary)
export const RADAR_REFRESH_MS = 5 * 60_000  // IEM NEXRAD updates every ~5 min

// Radar layer slug for IEM tile service, e.g. "USCOMP-N0Q-0" or "RTX-N0Q-0".
// Defaulting to RTX gives much better local detail around the current map center.
export const RADAR_LAYER = import.meta.env.VITE_RADAR_LAYER || 'RTX-N0B-0'

// When zoomed out at or below this threshold, switch to a broad composite
// product so users still see regional context outside local radar coverage.
export const RADAR_FALLBACK_MAX_ZOOM = Number(import.meta.env.VITE_RADAR_FALLBACK_MAX_ZOOM || 6)
export const RADAR_FALLBACK_LAYER = import.meta.env.VITE_RADAR_FALLBACK_LAYER || 'USCOMP-N0Q-0'

// Observation range ring — radius in km centered on DEFAULT_CENTER.
// Set VITE_OBSERVATION_RANGE_KM=0 to hide the ring.
export const OBSERVATION_RANGE_KM = Number(import.meta.env.VITE_OBSERVATION_RANGE_KM ?? 50)
