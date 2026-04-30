import { useEffect, useRef } from 'react'
import { WS_URL } from '../config'
import { useCivicStore } from '../store'
import { wsTokenParam } from '../auth'
import { initNotifications, maybeNotify } from '../notifications'

const RECONNECT_DELAY_MS = 3000

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const {
    setEntities,
    setAircraftSnapshot,
    upsertEntity,
    purgeStaleEntities,
    setConnected,
    setRadio,
    appendSystemEvent,
    setUtilityStatus,
    setOregonStatus,
    setAirports,
    setWeather,
    setAlerts,
    setNews,
    setCameras,
    setTrafficFlow,
    setTrafficIncidents,
    setSummary,
  } = useCivicStore()

  useEffect(() => {
    let cancelled = false

    initNotifications()

    const cleanupInterval = setInterval(() => {
      purgeStaleEntities()
    }, 10000)

    const connect = () => {
      if (cancelled) return
      const ws = new WebSocket(WS_URL + wsTokenParam())
      wsRef.current = ws

      ws.onopen  = () => setConnected(true)
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        setConnected(false)
        if (!cancelled) setTimeout(connect, RECONNECT_DELAY_MS)
      }

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string)
        switch (msg.type) {
          case 'snapshot':
            setEntities(msg.data)
            break
          case 'entity_update':
            upsertEntity(msg.data)
            break
          case 'aircraft_snapshot':
            if (msg.data?.schema_version !== undefined && msg.data.schema_version !== 1) {
              console.warn('[ws] aircraft_snapshot schema_version mismatch:', msg.data.schema_version)
            }
            if (Array.isArray(msg.data?.aircraft)) {
              setAircraftSnapshot(msg.data.aircraft)
            }
            if (msg.data?.airports && typeof msg.data.airports === 'object') {
              setAirports(msg.data.airports)
            }
            break
          case 'feed_update':
          case 'radio_update':
            if (msg.key === 'radio:active' || msg.type === 'radio_update') {
              setRadio(msg.data ?? msg)
            } else if (msg.key === 'utility:pge') {
              setUtilityStatus(msg.data)
            } else if (msg.key === 'utility:oregon') {
              setOregonStatus(msg.data)
            } else if (msg.key === 'weather:current' && msg.data && typeof msg.data === 'object') {
              const data = msg.data as Record<string, unknown>
              setWeather({
                temp_f: typeof data.temp_f === 'number' ? data.temp_f : undefined,
                wind_mph: typeof data.wind_mph === 'number' ? data.wind_mph : undefined,
                wind_dir: typeof data.wind_dir === 'string' ? data.wind_dir : undefined,
                condition: typeof data.condition === 'string' ? data.condition : undefined,
                humidity: typeof data.humidity === 'number' ? data.humidity : undefined,
                aqi: typeof data.aqi === 'number' ? data.aqi : undefined,
                aqi_label: typeof data.aqi_label === 'string' ? data.aqi_label : undefined,
              })
            } else if (msg.key === 'weather:alerts' && Array.isArray(msg.data)) {
              setWeather({ alerts: msg.data as Parameters<typeof setWeather>[0]['alerts'] })
            } else if (msg.key === 'alerts:flash' && Array.isArray(msg.data)) {
              setAlerts(msg.data as Parameters<typeof setAlerts>[0])
            } else if (msg.key === 'news:local' && Array.isArray(msg.data)) {
              setNews(msg.data as Parameters<typeof setNews>[0])
            } else if (msg.key === 'traffic:cameras' && Array.isArray(msg.data)) {
              setCameras(msg.data as Parameters<typeof setCameras>[0])
            } else if (msg.key === 'traffic:flow' && Array.isArray(msg.data)) {
              setTrafficFlow(msg.data)
            } else if (msg.key === 'traffic:incidents' && Array.isArray(msg.data)) {
              setTrafficIncidents(msg.data)
            } else if (msg.key === 'summary:latest' && msg.data && typeof msg.data === 'object') {
              const data = msg.data as Record<string, unknown>
              setSummary({
                summary: typeof data.summary === 'string' ? data.summary : '',
                ts: typeof data.ts === 'string' ? data.ts : null,
                model: typeof data.model === 'string' ? data.model : null,
              })
            }
            break
          case 'event':
            appendSystemEvent(msg.data)
            maybeNotify(msg.data)
            break
        }
      }
    }

    connect()
    return () => {
      cancelled = true
      clearInterval(cleanupInterval)
      if (wsRef.current) {
        wsRef.current.onopen = null
        wsRef.current.onerror = null
        wsRef.current.onclose = null
        wsRef.current.onmessage = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])
}
