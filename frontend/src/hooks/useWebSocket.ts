import { useEffect, useRef } from 'react'
import { WS_URL } from '../config'
import { useCivicStore } from '../store'
import { wsTokenParam } from '../auth'
import { initNotifications, maybeNotify } from '../notifications'

const RECONNECT_DELAY_INITIAL_MS = 1000
const RECONNECT_DELAY_MAX_MS = 60_000

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectDelayRef = useRef(RECONNECT_DELAY_INITIAL_MS)
  const emptyAircraftSnapshotStreakRef = useRef(0)
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
    appendLightningStrikes,
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

      ws.onopen  = () => {
        setConnected(true)
        reconnectDelayRef.current = RECONNECT_DELAY_INITIAL_MS
      }
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        setConnected(false)
        if (!cancelled) {
          setTimeout(connect, reconnectDelayRef.current)
          reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, RECONNECT_DELAY_MAX_MS)
        }
      }

      ws.onmessage = (e) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(e.data as string)
        } catch (err) {
          console.warn('[ws] malformed frame, ignoring:', err)
          return
        }
        const msgData = msg.data as Record<string, unknown> | undefined
        switch (msg.type) {
          case 'snapshot':
            setEntities(msg.data as Parameters<typeof setEntities>[0])
            break
          case 'entity_update':
            upsertEntity(msg.data as Parameters<typeof upsertEntity>[0])
            break
          case 'aircraft_snapshot': {
            if (msgData?.schema_version !== undefined && msgData.schema_version !== 1) {
              console.warn('[ws] aircraft_snapshot schema_version mismatch:', msgData.schema_version)
            }
            if (Array.isArray(msgData?.aircraft)) {
              const aircraft = msgData.aircraft as Parameters<typeof setAircraftSnapshot>[0]
              if (aircraft.length === 0) {
                const state = useCivicStore.getState()
                const existingLocalAircraft = Object.values(state.entities).filter(
                  (e) => e.entity_type === 'aircraft' && (e.source ?? '').toLowerCase() !== 'opensky',
                ).length
                const beastHealthy = msgData?.beast_healthy === true
                const lastFrameAge = typeof msgData?.last_frame_age_s === 'number' ? msgData.last_frame_age_s : null

                emptyAircraftSnapshotStreakRef.current += 1

                // Ignore short empty bursts while BEAST is healthy to prevent global
                // icon wipe/repopulate cycles caused by transient decoder/snapshot gaps.
                if (
                  existingLocalAircraft > 0
                  && beastHealthy
                  && (lastFrameAge === null || lastFrameAge < 20)
                  && emptyAircraftSnapshotStreakRef.current < 3
                ) {
                  console.warn('[ws] ignoring transient empty aircraft_snapshot while BEAST is healthy')
                  break
                }
              } else {
                emptyAircraftSnapshotStreakRef.current = 0
              }

              setAircraftSnapshot(aircraft)
            }
            if (msgData?.airports && typeof msgData.airports === 'object') {
              setAirports(msgData.airports as Parameters<typeof setAirports>[0])
            }
            break
          }
          case 'feed_update':
          case 'radio_update':
            if (msg.key === 'radio:active' || msg.type === 'radio_update') {
              setRadio((msgData ?? msg) as unknown as Parameters<typeof setRadio>[0])
            } else if (msg.key === 'utility:pge') {
              setUtilityStatus(msg.data as Parameters<typeof setUtilityStatus>[0])
            } else if (msg.key === 'utility:oregon') {
              setOregonStatus(msg.data as Parameters<typeof setOregonStatus>[0])
            } else if (msg.key === 'weather:current' && msgData) {
              setWeather({
                temp_f: typeof msgData.temp_f === 'number' ? msgData.temp_f : undefined,
                wind_mph: typeof msgData.wind_mph === 'number' ? msgData.wind_mph : undefined,
                wind_dir: typeof msgData.wind_dir === 'string' ? msgData.wind_dir : undefined,
                condition: typeof msgData.condition === 'string' ? msgData.condition : undefined,
                humidity: typeof msgData.humidity === 'number' ? msgData.humidity : undefined,
                aqi: typeof msgData.aqi === 'number' ? msgData.aqi : undefined,
                aqi_label: typeof msgData.aqi_label === 'string' ? msgData.aqi_label : undefined,
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
              setTrafficFlow(msg.data as Parameters<typeof setTrafficFlow>[0])
            } else if (msg.key === 'traffic:incidents' && Array.isArray(msg.data)) {
              setTrafficIncidents(msg.data as Parameters<typeof setTrafficIncidents>[0])
            } else if (msg.key === 'lightning:strikes' && Array.isArray(msg.data)) {
              appendLightningStrikes(msg.data as Parameters<typeof appendLightningStrikes>[0])
            } else if (msg.key === 'summary:latest' && msgData) {
              setSummary({
                summary: typeof msgData.summary === 'string' ? msgData.summary : '',
                ts: typeof msgData.ts === 'string' ? msgData.ts : null,
                model: typeof msgData.model === 'string' ? msgData.model : null,
              })
            }
            break
          case 'event':
            appendSystemEvent(msg.data as Parameters<typeof appendSystemEvent>[0])
            maybeNotify(msg.data as Parameters<typeof maybeNotify>[0])
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
