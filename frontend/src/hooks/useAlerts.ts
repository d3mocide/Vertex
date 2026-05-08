import { useEffect, useRef } from 'react'
import { API_BASE, ALERTS_POLL_MS, NEWS_POLL_MS, WEATHER_POLL_MS, CAMERAS_POLL_MS } from '../config'
import { useCivicStore } from '../store'
import { authHeaders, clearToken } from '../auth'
import type { TrafficFlowSensor, UtilityStatus, OregonStatus } from '../storeTypes'

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: authHeaders() })
    if (res.status === 401) { clearToken(); window.location.reload(); return null }
    if (!res.ok) return null
    return res.json() as Promise<T>
  } catch {
    return null
  }
}

export function useAlerts() {
  const {
    setAlerts,
    setNews,
    setWeather,
    setCameras,
    setTrafficFlow,
    setTrafficIncidents,
    setUtilityStatus,
    setOregonStatus,
    setSummary,
  } = useCivicStore()
  const timers = useRef<ReturnType<typeof setInterval>[]>([])

  useEffect(() => {
    // Fetch alerts
    const pollAlerts = async () => {
      const data = await fetchJson<unknown[]>(`${API_BASE}/alerts`)
      if (Array.isArray(data)) setAlerts(data as Parameters<typeof setAlerts>[0])
    }

    // Fetch local/newsroom feeds
    const pollNews = async () => {
      const data = await fetchJson<unknown[]>(`${API_BASE}/news`)
      if (Array.isArray(data)) setNews(data as Parameters<typeof setNews>[0])
    }

    // Fetch weather
    const pollWeather = async () => {
      const [current, alerts] = await Promise.all([
        fetchJson<Record<string, unknown>>(`${API_BASE}/weather`),
        fetchJson<unknown[]>(`${API_BASE}/weather/alerts`),
      ])
      if (current) {
        setWeather({
          temp_f:    current['temp_f']    as number | undefined,
          wind_mph:  current['wind_mph']  as number | undefined,
          wind_dir:  current['wind_dir']  as string | undefined,
          condition: current['condition'] as string | undefined,
          humidity:  current['humidity']  as number | undefined,
          aqi:       current['aqi']       as number | undefined,
          aqi_label: current['aqi_label'] as string | undefined,
        })
      }
      if (Array.isArray(alerts)) {
        setWeather({ alerts: alerts as Parameters<typeof setWeather>[0]['alerts'] })
      }
    }

    // Fetch cameras
    const pollCameras = async () => {
      const data = await fetchJson<unknown[]>(`${API_BASE}/traffic/cameras`)
      if (Array.isArray(data)) setCameras(data as Parameters<typeof setCameras>[0])
    }

    // Fetch flow
    const pollFlow = async () => {
      const data = await fetchJson<unknown[]>(`${API_BASE}/traffic/flow`)
      if (Array.isArray(data)) setTrafficFlow(data as TrafficFlowSensor[])
    }

    // Fetch incidents
    const pollIncidents = async () => {
      const data = await fetchJson<unknown[]>(`${API_BASE}/traffic/incidents`)
      if (Array.isArray(data)) setTrafficIncidents(data as Parameters<typeof setTrafficIncidents>[0])
    }

    // Fetch AI situational summary
    const pollSummary = async () => {
      const data = await fetchJson<Record<string, unknown>>(`${API_BASE}/summary`)
      if (!data) return
      setSummary({
        summary: typeof data.summary === 'string' ? data.summary : '',
        ts: typeof data.ts === 'string' ? data.ts : null,
        model: typeof data.model === 'string' ? data.model : null,
      })
    }

    // Fetch utilities
    const pollUtilities = async () => {
      const [pge, oregon] = await Promise.all([
        fetchJson<UtilityStatus>(`${API_BASE}/utilities/pge`),
        fetchJson<OregonStatus>(`${API_BASE}/utilities/oregon`),
      ])
      if (pge) setUtilityStatus(pge)
      if (oregon) setOregonStatus(oregon)
    }

    // Initial fetch
    pollAlerts()
    pollNews()
    pollWeather()
    pollCameras()
    pollFlow()
    pollIncidents()
    pollUtilities()
    pollSummary()

    // Schedule polling
    timers.current = [
      setInterval(pollAlerts,  ALERTS_POLL_MS),
      setInterval(pollNews,    NEWS_POLL_MS),
      setInterval(pollWeather, WEATHER_POLL_MS),
      setInterval(pollCameras, CAMERAS_POLL_MS),
      setInterval(pollFlow,    30000), // 30s for flow
      setInterval(pollIncidents, 30000), // 30s for incidents
      setInterval(pollUtilities, 60000), // 60s for utilities
      setInterval(pollSummary, 60000), // 60s for summary display freshness
    ]

    return () => timers.current.forEach(clearInterval)
  }, [])
}
