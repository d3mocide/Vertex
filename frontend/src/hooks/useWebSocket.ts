import { useEffect, useRef } from 'react'
import { WS_URL } from '../config'
import { useCivicStore } from '../store'
import type { EntityTypeFilter } from '../storeTypes'
import { wsTokenParam } from '../auth'
import { initNotifications, maybeNotify, notifyMeshMessage } from '../notifications'

const RECONNECT_DELAY_INITIAL_MS = 1000
const RECONNECT_DELAY_MAX_MS = 60_000

// All known entity types tracked by EntityTypeFilter keys.
// adsbLocal / adsbSupplement are frontend sub-filters of 'aircraft'; the
// backend only knows 'aircraft' as the entity_type.
const FILTER_KEY_TO_ENTITY_TYPE: Partial<Record<keyof EntityTypeFilter, string>> = {
  aircraft:        'aircraft',
  vessel:          'vessel',
  mesh_node:       'mesh_node',
  aprs:            'aprs',
  fire_incident:   'fire_incident',
  satellite:       'satellite',
  tinygs_station:  'tinygs_station',
  train:           'train',
}

/**
 * Build a subscribe message from the current store filter state.
 * Returns null if all filters are at their defaults (no active filtering),
 * so we avoid sending an unnecessary subscribe with no effect.
 */
function buildSubscription(
  entityFilter: EntityTypeFilter,
  bbox: [number, number, number, number] | null,
): { type: 'subscribe'; bbox?: [number, number, number, number]; entity_types?: string[] } | null {
  // Collect entity types that are currently disabled
  const enabledTypes: string[] = []
  let anyDisabled = false

  for (const [key, entityType] of Object.entries(FILTER_KEY_TO_ENTITY_TYPE) as [keyof EntityTypeFilter, string][]) {
    if (entityFilter[key]) {
      // Only add each entity type once (aircraft appears for both adsbLocal/adsbSupplement keys,
      // but FILTER_KEY_TO_ENTITY_TYPE omits those sub-keys so aircraft appears once)
      if (!enabledTypes.includes(entityType)) {
        enabledTypes.push(entityType)
      }
    } else {
      anyDisabled = true
    }
  }

  // adsbLocal / adsbSupplement are sub-filters of aircraft — if either is disabled
  // we still need 'aircraft' in the server list (server doesn't distinguish by source).
  // So we only remove aircraft from server filter if the top-level 'aircraft' flag is false.
  // (adsbLocal/adsbSupplement filtering remains a client-side concern only.)

  const hasEntityTypeFilter = anyDisabled && enabledTypes.length > 0
  const hasBboxFilter = bbox !== null

  if (!hasEntityTypeFilter && !hasBboxFilter) {
    return null
  }

  const sub: { type: 'subscribe'; bbox?: [number, number, number, number]; entity_types?: string[] } = {
    type: 'subscribe',
  }
  if (hasBboxFilter && bbox !== null) {
    sub.bbox = bbox
  }
  if (hasEntityTypeFilter) {
    sub.entity_types = enabledTypes
  }
  return sub
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectDelayRef = useRef(RECONNECT_DELAY_INITIAL_MS)
  const emptyAircraftSnapshotStreakRef = useRef(0)
  const degradedAircraftSnapshotStreakRef = useRef(0)
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
    appendMeshMessage,
    updateLinkHistory,
    setMeshStatus,
    appendAcarsMessage,
  } = useCivicStore()

  useEffect(() => {
    let cancelled = false

    initNotifications()

    const cleanupInterval = setInterval(() => {
      purgeStaleEntities()
    }, 10000)

    const sendSubscription = (ws: WebSocket) => {
      if (ws.readyState !== WebSocket.OPEN) return
      const state = useCivicStore.getState()
      const sub = buildSubscription(state.entityFilter, null)
      if (sub) {
        ws.send(JSON.stringify(sub))
      }
    }

    const connect = () => {
      if (cancelled) return
      const ws = new WebSocket(WS_URL + wsTokenParam())
      wsRef.current = ws

      ws.onopen  = () => {
        setConnected(true)
        reconnectDelayRef.current = RECONNECT_DELAY_INITIAL_MS
        // Send current subscription filter immediately after connecting
        sendSubscription(ws)
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
              const state = useCivicStore.getState()
              const existingLocalAircraft = Object.values(state.entities).filter(
                (e) => e.entity_type === 'aircraft' && (e.source ?? '').toLowerCase() !== 'opensky',
              ).length
              const snapshotLocalAircraft = aircraft.filter(
                (e) => e.entity_type === 'aircraft' && (e.source ?? '').toLowerCase() !== 'opensky',
              ).length
              const beastHealthy = msgData?.beast_healthy === true
              const lastFrameAge = typeof msgData?.last_frame_age_s === 'number' ? msgData.last_frame_age_s : null

              let shouldSkipSnapshot = false

              if (aircraft.length === 0) {
                emptyAircraftSnapshotStreakRef.current += 1

                // While BEAST is healthy and frames are fresh, never wipe existing
                // aircraft with an empty snapshot — empty bursts are always transient
                // decoder/snapshot gaps during this mode.  Only allow the wipe when
                // BEAST is definitively unhealthy or its last frame is stale (>20 s).
                if (
                  existingLocalAircraft > 0
                  && beastHealthy
                  && (lastFrameAge === null || lastFrameAge < 20)
                ) {
                  console.warn('[ws] ignoring empty aircraft_snapshot while BEAST is healthy')
                  shouldSkipSnapshot = true
                }
              } else {
                emptyAircraftSnapshotStreakRef.current = 0

                // Guard against brief partial snapshots that would purge most local
                // ADS-B tracks despite healthy decoder frames still arriving.
                const severeDrop = (
                  existingLocalAircraft >= 10
                  && snapshotLocalAircraft > 0
                  && snapshotLocalAircraft <= Math.max(2, Math.floor(existingLocalAircraft * 0.2))
                )
                if (
                  severeDrop
                  && beastHealthy
                  && (lastFrameAge === null || lastFrameAge < 20)
                  && degradedAircraftSnapshotStreakRef.current < 3
                ) {
                  degradedAircraftSnapshotStreakRef.current += 1
                  console.warn(
                    '[ws] ignoring degraded aircraft_snapshot while BEAST is healthy',
                    { existingLocalAircraft, snapshotLocalAircraft, streak: degradedAircraftSnapshotStreakRef.current },
                  )
                  shouldSkipSnapshot = true
                } else {
                  // Only reset the streak when this snapshot is NOT a severe drop,
                  // so the counter accumulates correctly across consecutive degraded frames.
                  degradedAircraftSnapshotStreakRef.current = 0
                }
              }

              if (!shouldSkipSnapshot) {
                setAircraftSnapshot(aircraft)
              }
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
          case 'mesh_message':
            appendMeshMessage(msg.data as any)
            notifyMeshMessage(msg.data as any)
            break
          case 'mesh_links':
            updateLinkHistory(msg.data as any)
            break
          case 'mesh_status':
            setMeshStatus(msg.data)
            break
          case 'acars_message':
            appendAcarsMessage(msg.data as Parameters<typeof appendAcarsMessage>[0])
            break
          case 'event':
            appendSystemEvent(msg.data as Parameters<typeof appendSystemEvent>[0])
            maybeNotify(msg.data as Parameters<typeof maybeNotify>[0])
            break
        }
      }
    }

    // Subscribe to entityFilter changes and re-send subscription when filter changes
    const unsubscribeStore = useCivicStore.subscribe(
      (state, prevState) => {
        if (state.entityFilter !== prevState.entityFilter) {
          const ws = wsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) {
            sendSubscription(ws)
          }
        }
      },
    )

    connect()
    return () => {
      cancelled = true
      clearInterval(cleanupInterval)
      unsubscribeStore()
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
