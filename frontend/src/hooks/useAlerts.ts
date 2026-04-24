import { useEffect, useRef } from 'react'
import { API_BASE, ALERTS_POLL_MS, NEWS_POLL_MS, WEATHER_POLL_MS, CAMERAS_POLL_MS } from '../config'
import { useCivicStore } from '../store'

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return res.json() as Promise<T>
  } catch {
    return null
  }
}

export function useAlerts() {
  const { setAlerts, setNews, setWeather, setCameras, setTrafficFlow, setUtilityStatus } = useCivicStore()
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
      if (Array.isArray(data)) setTrafficFlow(data as any[])
    }

    // Fetch utilities
    const pollUtilities = async () => {
      const [pge, oregon] = await Promise.all([
        fetchJson<any>(`${API_BASE}/utilities/pge`),
        fetchJson<any>(`${API_BASE}/utilities/oregon`),
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
    pollUtilities()

    // Schedule polling
    timers.current = [
      setInterval(pollAlerts,  ALERTS_POLL_MS),
      setInterval(pollNews,    NEWS_POLL_MS),
      setInterval(pollWeather, WEATHER_POLL_MS),
      setInterval(pollCameras, CAMERAS_POLL_MS),
      setInterval(pollFlow,    30000), // 30s for flow
      setInterval(pollUtilities, 60000), // 60s for utilities
    ]

    return () => timers.current.forEach(clearInterval)
  }, [])
}
