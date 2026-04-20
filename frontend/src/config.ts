export const API_BASE = '/api/v1'

export const WS_URL =
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

// OpenFreeMap — free, no key, multi-arch tile server
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

// Default view: Tualatin, OR
export const DEFAULT_CENTER: [number, number] = [-122.7635, 45.3842]
export const DEFAULT_ZOOM = 10
