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

  useEffect(() => {
    for (const [entityId, entity] of Object.entries(entities)) {
      if (entity.entity_type !== 'aircraft') continue
      if (fetchedRef.current.has(entityId)) continue

      // Mark immediately so concurrent renders don't double-fetch.
      fetchedRef.current.add(entityId)

      const url = `${API_BASE}/entities/${encodeURIComponent(entityId)}/trail?minutes=${HISTORY_MINUTES}`

      fetch(url, { headers: authHeaders() })
        .then((res) => {
          if (!res.ok) return null
          return res.json() as Promise<ObservationRow[]>
        })
        .then((rows) => {
          if (!rows || rows.length === 0) return

          const pts: TrailPt[] = rows
            .map(rowToTrailPt)
            .filter((p): p is TrailPt => p !== null)

          if (pts.length === 0) return

          const sampled = subsample(pts, DB_POINT_CAP)
          historicalTrailCache.set(entityId, sampled)

          // Re-run entityToTrack so the richer trail shows immediately.
          refreshEntityTrack(entityId)
        })
        .catch(() => {
          // Non-fatal — trail falls back to BEAST ring buffer.
        })
    }
  }, [entities, refreshEntityTrack])
}
