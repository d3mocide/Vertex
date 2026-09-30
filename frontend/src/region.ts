import { API_BASE, applyRegion } from './config'
import { authHeaders } from './auth'

export interface RegionConfig {
  name: string
  center: [number, number]            // [lat, lon]
  bbox: { min_lat: number; max_lat: number; min_lon: number; max_lon: number }
  timezone: string
  nws: Record<string, string> | null
  source: 'env' | 'database' | 'default'
  locked: boolean                     // pinned by REGION_LAT / REGION_LON in the environment
  locked_by: string[]
  configured: boolean
  updated_at: string | null
}

/**
 * Load the operator's region from the backend and apply it. Falls back to the built-in defaults
 * if the request fails or takes too long, so the app always starts.
 */
export async function loadRegion(timeoutMs = 4000): Promise<RegionConfig | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}/config/region`, { headers: authHeaders(), signal: ctrl.signal })
    if (!res.ok) return null
    const region = (await res.json()) as RegionConfig
    applyRegion(region.name, region.center[0], region.center[1])
    return region
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}
