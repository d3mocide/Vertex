/**
 * useTrailHydration
 *
 * On first appearance of each aircraft entity, fetches the full DB observation
 * trail from the backend and populates historicalTrailCache in entityUtils.ts.
 * This gives tracks hours of visible flight history instead of the ~2.5-minute
 * BEAST in-memory ring buffer.
 *
 * Behaviour mirrors how FlightJar (tar1090) loads persistent disk trace files
 * before overlaying the live feed.
 */
import { useEffect, useRef } from 'react'
import { useCivicStore } from '../store'
import { historicalTrailCache, ALT_FT_TO_M, SPD_KT_TO_MS } from '../entityUtils'
import type { TrailPt } from '../storeTypes'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

// Aircraft trail settings
const HISTORY_MINUTES = 120
const DB_POINT_CAP = 500

// APRS trail settings — slower-moving, lower priority, longer window
const APRS_HISTORY_MINUTES = 1440  // 24 hours
const APRS_POINT_CAP = 200

interface ObservationRow {
  ts:        string
  lat:       number | null
  lon:       number | null
  altitude?: number | null  // feet
  speed?:    number | null  // knots
}

/** Convert a backend observation row to a TrailPt tuple. */
function rowToTrailPt(row: ObservationRow): TrailPt | null {
  if (row.lat == null || row.lon == null) return null
  return [
    row.lon,
    row.lat,
    (row.altitude ?? 0) * ALT_FT_TO_M,
    (row.speed ?? 0) * SPD_KT_TO_MS,
    row.ts,
  ]
}

/** Evenly sub-sample an array to at most maxPts entries. */
function subsample<T>(arr: T[], maxPts: number): T[] {
  if (arr.length <= maxPts) return arr
  const step = arr.length / maxPts
  return Array.from({ length: maxPts }, (_, i) => arr[Math.floor(i * step)])
}

export function useTrailHydration(): void {
  const entities          = useCivicStore((s) => s.entities)
  const refreshEntityTrack = useCivicStore((s) => s.refreshEntityTrack)

  // Track which entity IDs we have already fetched (or are fetching).
  const fetchedRef = useRef(new Set<string>())
  // Separate queues: aircraft is drained first, aprs after.
  const aircraftQueueRef = useRef<string[]>([])
  const aprsQueueRef = useRef<string[]>([])
  // Maps entity_id → entity_type so processQueue can use correct fetch params.
  const entityTypesRef = useRef(new Map<string, string>())
  const processingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // Prune fetchedRef entries for entities that have left the store, so they
  // can be re-fetched if they reappear.
  useEffect(() => {
    const currentIds = new Set(Object.keys(entities))
    for (const id of fetchedRef.current) {
      if (!currentIds.has(id)) fetchedRef.current.delete(id)
    }

    const newAircraft: string[] = []
    const newAprs: string[] = []

    for (const [id, e] of Object.entries(entities)) {
      if (fetchedRef.current.has(id)) continue
      if (e.entity_type === 'aircraft') newAircraft.push(id)
      else if (e.entity_type === 'aprs') newAprs.push(id)
    }

    if (newAircraft.length > 0 || newAprs.length > 0) {
      for (const id of newAircraft) {
        fetchedRef.current.add(id)
        entityTypesRef.current.set(id, 'aircraft')
      }
      for (const id of newAprs) {
        fetchedRef.current.add(id)
        entityTypesRef.current.set(id, 'aprs')
      }
      aircraftQueueRef.current.push(...newAircraft)
      aprsQueueRef.current.push(...newAprs)
    }

    const hasWork = aircraftQueueRef.current.length > 0 || aprsQueueRef.current.length > 0
    if (hasWork && !processingRef.current) {
      processQueue()
    }
  }, [entities])

  // Abort any in-flight fetch on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const processQueue = async () => {
    const hasWork = () =>
      aircraftQueueRef.current.length > 0 || aprsQueueRef.current.length > 0

    if (processingRef.current || !hasWork()) return
    processingRef.current = true

    while (hasWork()) {
      // Drain aircraft queue first; fall back to APRS.
      const entityId = (aircraftQueueRef.current.shift() ?? aprsQueueRef.current.shift())!
      const entityType = entityTypesRef.current.get(entityId) ?? 'aircraft'
      const historyMinutes = entityType === 'aprs' ? APRS_HISTORY_MINUTES : HISTORY_MINUTES
      const pointCap = entityType === 'aprs' ? APRS_POINT_CAP : DB_POINT_CAP

      const url = `${API_BASE}/entities/${encodeURIComponent(entityId)}/trail?minutes=${historyMinutes}`
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(url, { headers: authHeaders(), signal: controller.signal })
        if (res.status === 429) {
          console.warn(`[trail] Rate limited (429) for ${entityId}, backing off...`)
          // Re-queue in the appropriate queue.
          if (entityType === 'aprs') aprsQueueRef.current.unshift(entityId)
          else aircraftQueueRef.current.unshift(entityId)
          await new Promise(resolve => setTimeout(resolve, 5000))
          continue
        }

        if (res.ok) {
          const rows = await res.json() as ObservationRow[]
          if (rows && rows.length > 0) {
            const pts: TrailPt[] = rows
              .map(rowToTrailPt)
              .filter((p): p is TrailPt => p !== null)

            if (pts.length > 0) {
              const sampled = subsample(pts, pointCap)
              historicalTrailCache.set(entityId, sampled)
              refreshEntityTrack(entityId)
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') break
        console.error(`[trail] Failed to fetch trail for ${entityId}`, err)
      }

      // Small delay between requests to prevent bursts
      await new Promise(resolve => setTimeout(resolve, 400))
    }

    abortRef.current = null
    processingRef.current = false
  }
}
