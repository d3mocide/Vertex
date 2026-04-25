export const API_BASE = '/api/v1'

export const WS_URL =
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

// OpenFreeMap — dark style for tactical dark mode
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'



// Default view: Tualatin, OR
export const DEFAULT_CENTER: [number, number] = [
  Number(import.meta.env.VITE_REGION_LON ?? -122.7635),
  Number(import.meta.env.VITE_REGION_LAT ?? 45.3842),
]
export const DEFAULT_ZOOM = 10

// Audio stream
export const STREAM_URL = import.meta.env.VITE_RADIO_STREAM_URL || '/stream/radio.mp3'

// Polling intervals (ms)
export const HEALTH_POLL_MS   = 15_000
export const ALERTS_POLL_MS   = 30_000
export const NEWS_POLL_MS     = 60_000
export const WEATHER_POLL_MS  = 60_000
export const CAMERAS_POLL_MS  = 120_000
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
