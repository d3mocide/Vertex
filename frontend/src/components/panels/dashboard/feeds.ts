import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'

/** Poll a JSON endpoint while mounted; keeps the last good value through transient errors. */
function usePolledJson<T>(path: string, intervalMs: number, enabled = true): T | null {
  const [data, setData] = useState<T | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const controller = new AbortController()
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), signal: controller.signal })
        if (!res.ok) return
        const body = (await res.json()) as T
        if (!cancelled) setData(body)
      } catch {
        // Optional dashboard context: keep what we had.
      }
    }
    void load()
    const timer = setInterval(() => void load(), intervalMs)
    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
    }
  }, [path, intervalMs, enabled])
  return data
}

// ── /dashboard/history ───────────────────────────────────────────────────────
export type HistorySeries = 'aircraft' | 'vessel' | 'mesh_node' | 'radio_call' | 'dispatch_incident'

export interface DashboardHistory {
  series: Record<HistorySeries, number[]>
  totals: Record<HistorySeries, number>
  dispatch_categories: [string, number][]
  life_safety_24h: number
  talkgroups: { tgid: string; label: string | null; calls: number }[]
}

export function useDashboardHistory(enabled = true): DashboardHistory | null {
  return usePolledJson<DashboardHistory>('/dashboard/history', 120_000, enabled)
}

// ── /weather/forecast ────────────────────────────────────────────────────────
export interface ForecastHour {
  ts: string
  temp_f: number | null
  pop: number | null
  wind_mph: number | null
  wind_dir: string
  short: string
}
export interface ForecastPeriod {
  name: string
  temp_f: number | null
  is_day: boolean
  pop: number | null
  short: string
  detail?: string
}
export interface Forecast {
  hourly: ForecastHour[]
  periods: ForecastPeriod[]
  updated: string | null
}

export function useForecast(enabled = true): Forecast | null {
  return usePolledJson<Forecast>('/weather/forecast', 900_000, enabled)
}

// ── /radio/ems-activity ──────────────────────────────────────────────────────
export interface EmsSyndrome {
  key: string
  label: string
  count: number
  count_6h: number
  baseline: number | null
  baseline_6h: number | null
  flag: boolean
}
export interface EmsFeed {
  ts: string | null
  reports: number
  reports_baseline: number | null
  baseline_days: number
  building: boolean
  flags?: string[]
  syndromes: EmsSyndrome[]
}

export function useEmsActivity(enabled = true): EmsFeed | null {
  return usePolledJson<EmsFeed>('/radio/ems-activity', 300_000, enabled)
}

export const hourLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '').toLowerCase()
