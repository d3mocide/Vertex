import { API_BASE } from './config'
import { authHeaders } from './auth'

/** What the setup wizard needs from the backend (see backend/routers/setup.py and region.py). */
export interface SetupStatus {
  needs_setup: boolean
  source: 'env' | 'database' | 'default'
  locked: boolean
  locked_by: string[]
  pack: string | null
  poller: { state: string; region: string | null }
  restart_required: boolean
}

export interface PackKey { name: string; where: string; free: boolean; unlocks: string[]; present: boolean }

export interface PackInfo {
  id: string
  name: string
  description?: string
  maintainers?: string[]
  covers?: { states: string[]; bbox: number[] | null }
  provides?: { id: string; title: string }[]
  keys?: PackKey[]
  valid: boolean
  error: string | null
  suggested: boolean
}

export interface ResolvedLocation {
  office: string | null
  forecast_zone: string | null
  county_zone: string | null
  fire_zone: string | null
  timezone: string | null
  city: string | null
  state: string | null
  suggested_name: string | null
  radius_km: number
}

export interface RegionDraft {
  name: string
  lat: number
  lon: number
  radius_km: number
  timezone: string
  nws?: Record<string, string>
  pack: string            // an installed pack id, or 'none' for core feeds only
}

export class SetupError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try { detail = (await res.json()).detail ?? detail } catch { /* keep the status text */ }
    throw new SetupError(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res.json() as Promise<T>
}

export const fetchSetupStatus = () => call<SetupStatus>('/setup/status')

export function fetchPacks(lat?: number, lon?: number, state?: string | null) {
  const q = new URLSearchParams()
  if (lat !== undefined && lon !== undefined) { q.set('lat', String(lat)); q.set('lon', String(lon)) }
  if (state) q.set('state', state)
  return call<PackInfo[]>(`/setup/packs${q.size ? `?${q}` : ''}`)
}

export const resolveLocation = (lat: number, lon: number) =>
  call<ResolvedLocation>('/config/region/resolve', { method: 'POST', body: JSON.stringify({ lat, lon }) })

export const saveRegion = (draft: RegionDraft) =>
  call<unknown>('/config/region', { method: 'PUT', body: JSON.stringify(draft) })
