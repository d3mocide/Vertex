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

// Fetch up to this many minutes of history for each aircraft.
const HISTORY_MINUTES = 120
// Sub-sample: keep at most this many DB points per aircraft.
// At 1 Hz that is DB_POINT_CAP seconds of history, evenly distributed.
const DB_POINT_CAP = 500

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
  const queueRef = useRef<string[]>([])
  const processingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // Prune fetchedRef entries for entities that have left the store, so they
  // can be re-fetched if they reappear.
  useEffect(() => {
    const currentIds = new Set(Object.keys(entities))
    for (const id of fetchedRef.current) {
      if (!currentIds.has(id)) fetchedRef.current.delete(id)
    }

    const newEntities = Object.entries(entities)
      .filter(([id, e]) => e.entity_type === 'aircraft' && !fetchedRef.current.has(id))
      .map(([id]) => id)

    if (newEntities.length > 0) {
      newEntities.forEach(id => fetchedRef.current.add(id))
      queueRef.current.push(...newEntities)
    }

    if (queueRef.current.length > 0 && !processingRef.current) {
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
    if (processingRef.current || queueRef.current.length === 0) return
    processingRef.current = true

    while (queueRef.current.length > 0) {
      const entityId = queueRef.current.shift()!
      const url = `${API_BASE}/entities/${encodeURIComponent(entityId)}/trail?minutes=${HISTORY_MINUTES}`
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(url, { headers: authHeaders(), signal: controller.signal })
        if (res.status === 429) {
          // Back off and re-queue if rate limited
          console.warn(`[trail] Rate limited (429) for ${entityId}, backing off...`)
          queueRef.current.unshift(entityId)
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
              const sampled = subsample(pts, DB_POINT_CAP)
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
