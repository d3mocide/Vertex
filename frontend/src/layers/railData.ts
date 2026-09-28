import { API_BASE } from '../config'
import { authHeaders } from '../auth'

export type RailPath = 'tracks' | 'gtfs-shapes'

// One request per path, shared by the rail map layer and train snapping.
// A failed or empty response is evicted so the next caller retries.
const inflight: Partial<Record<RailPath, Promise<GeoJSON.FeatureCollection | null>>> = {}

export function fetchRailGeoJSON(path: RailPath): Promise<GeoJSON.FeatureCollection | null> {
  const cached = inflight[path]
  if (cached) return cached
  const p = (async () => {
    try {
      const res = await fetch(`${API_BASE}/rail/${path}`, { headers: authHeaders() })
      if (!res.ok) return null
      const geojson = await res.json() as GeoJSON.FeatureCollection
      // Empty means the poller hasn't cached it yet.
      return geojson.features?.length ? geojson : null
    } catch {
      return null
    }
  })()
  inflight[path] = p
  p.then((g) => { if (!g) delete inflight[path] })
  return p
}
