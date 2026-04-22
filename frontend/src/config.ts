export const API_BASE = '/api/v1'

export const WS_URL =
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

// OpenFreeMap — dark style for tactical dark mode
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'



// Default view: Tualatin, OR
export const DEFAULT_CENTER: [number, number] = [-122.7635, 45.3842]
export const DEFAULT_ZOOM = 10

// Audio stream
export const STREAM_URL = '/stream/radio.mp3'

// Polling intervals (ms)
export const HEALTH_POLL_MS   = 15_000
export const ALERTS_POLL_MS   = 30_000
export const WEATHER_POLL_MS  = 60_000
export const CAMERAS_POLL_MS  = 120_000
export const RADAR_REFRESH_MS = 5 * 60_000  // IEM NEXRAD updates every ~5 min
