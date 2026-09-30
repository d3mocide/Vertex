import { useEffect, useRef } from 'react'
import { API_BASE, ALERTS_POLL_MS, NEWS_POLL_MS, WEATHER_POLL_MS, CAMERAS_POLL_MS } from '../config'
import { useCivicPick } from '../store'
import { authHeaders, clearToken } from '../auth'
import type { TrafficFlowSensor, UtilityStatus, RadioIncidentFeed, AdvisoryFeed, FeedMetaEntry } from '../storeTypes'
import { parseSummary } from '../summaryUtils'

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
    setSummary,
    setRadioIncidents,
    setAdvisories,
    setFeedMeta,
  } = useCivicPick('setAlerts', 'setNews', 'setWeather', 'setCameras', 'setTrafficFlow', 'setTrafficIncidents', 'setUtilityStatus', 'setSummary', 'setRadioIncidents', 'setAdvisories', 'setFeedMeta')
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
      setSummary(parseSummary(data))
    }

    // Radio-derived incidents (live updates arrive over the WebSocket)
    const pollRadioIncidents = async () => {
      const data = await fetchJson<RadioIncidentFeed>(`${API_BASE}/radio/incidents`)
      if (data && Array.isArray(data.incidents)) setRadioIncidents(data)
    }

    // Advisory bar (live updates arrive over the WebSocket)
    const pollAdvisories = async () => {
      const data = await fetchJson<AdvisoryFeed>(`${API_BASE}/alerts/advisories`)
      if (data && Array.isArray(data.items)) setAdvisories(data)
    }

    // Feed freshness (ages and stale thresholds for every data feed)
    const pollFeedMeta = async () => {
      const data = await fetchJson<Record<string, FeedMetaEntry>>(`${API_BASE}/health/feeds`)
      if (data && typeof data === 'object') setFeedMeta(data)
    }

    // Fetch utilities
    const pollUtilities = async () => {
      const pge = await fetchJson<UtilityStatus>(`${API_BASE}/utilities/pge`)
      if (pge) setUtilityStatus(pge)
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
    pollRadioIncidents()
    pollAdvisories()
    pollFeedMeta()

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
      setInterval(pollRadioIncidents, 120000), // fallback; WebSocket pushes changes
      setInterval(pollAdvisories, 60000),       // fallback; WebSocket pushes changes
      setInterval(pollFeedMeta, 60000),
    ]

    return () => timers.current.forEach(clearInterval)
  }, [])
}
