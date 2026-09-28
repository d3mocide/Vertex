import type { ReplayData, Track } from '../storeTypes'

/*
 * Replay: where each moving thing was at a moment in the window.
 *
 * An entity is drawn only while it is actually being tracked: from its first
 * observation until a short while after its last, and not across gaps
 * longer than its type normally goes quiet (an aircraft that left radar and
 * came back is not drawn sliding across the gap). Trails show only the recent
 * past. Timestamps are parsed once per loaded replay, not per frame.
 */

const ALT_FT_TO_M = 0.3048
const SPD_KT_TO_MS = 0.5144

type Kind = { type: Track['type']; gapMs: number; trailMs: number }
// gapMs: silence after which the entity is treated as gone (also how long it
// lingers after its last observation). trailMs: how much history to draw.
const KINDS: Record<string, Kind> = {
  aircraft: { type: 'air', gapMs: 90_000, trailMs: 10 * 60_000 },
  vessel:   { type: 'sea', gapMs: 15 * 60_000, trailMs: 30 * 60_000 },
  train:    { type: 'rail', gapMs: 10 * 60_000, trailMs: 20 * 60_000 },
  aprs:     { type: 'ground', gapMs: 30 * 60_000, trailMs: 60 * 60_000 },
}

interface Prepared {
  uid: string
  kind: Kind
  name: string
  ms: number[]
  lat: number[]
  lon: number[]
  alt: number[]     // metres
  spd: number[]     // m/s
  hdg: (number | null)[]
  iso: string[]
}

const prepared = new WeakMap<ReplayData, Prepared[]>()

function prepare(data: ReplayData): Prepared[] {
  const hit = prepared.get(data)
  if (hit) return hit
  const bucketMs = (data.bucket_s ?? 10) * 1000
  const out: Prepared[] = []
  for (const [uid, e] of Object.entries(data.entities)) {
    const base = KINDS[e.entity_type]
    if (!base || e.points.length === 0) continue    // static types never replay
    // Thinned data (long windows) spaces points a bucket apart: allow for it.
    const kind = { ...base, gapMs: Math.max(base.gapMs, 3 * bucketMs) }
    const pts = [...e.points].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    out.push({
      uid, kind, name: e.display_name ?? uid,
      ms: pts.map((p) => Date.parse(p.ts)),
      lat: pts.map((p) => p.lat),
      lon: pts.map((p) => p.lon),
      alt: pts.map((p) => (p.altitude ?? 0) * ALT_FT_TO_M),
      spd: pts.map((p) => (p.speed ?? 0) * SPD_KT_TO_MS),
      hdg: pts.map((p) => p.heading),
      iso: pts.map((p) => p.ts),
    })
  }
  prepared.set(data, out)
  return out
}

/** Index of the last observation at or before t, or -1. */
function lastAtOrBefore(ms: number[], t: number): number {
  let lo = 0, hi = ms.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ms[mid] <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

export function buildReplayTracks(data: ReplayData, atMs: number): Record<string, Track> {
  const result: Record<string, Track> = {}
  for (const p of prepare(data)) {
    const i = lastAtOrBefore(p.ms, atMs)
    if (i < 0) continue                                      // not seen yet
    const next = i + 1 < p.ms.length ? i + 1 : -1
    const sinceLast = atMs - p.ms[i]
    const gapAhead = next >= 0 ? p.ms[next] - p.ms[i] : Infinity
    if (sinceLast > p.kind.gapMs) continue                   // gone (left, or a long gap)

    // Interpolate only across normal spacing; otherwise hold the last fix.
    const t = next >= 0 && gapAhead <= p.kind.gapMs ? Math.min(1, sinceLast / gapAhead) : 0
    const j = t > 0 ? next : i
    const lerp = (a: number[]) => a[i] + (a[j] - a[i]) * t

    // Trail: recent history, back to the start of this continuous stretch.
    const trail: Track['trail'] = []
    for (let k = i; k >= 0; k--) {
      if (atMs - p.ms[k] > p.kind.trailMs) break
      if (k < i && p.ms[k + 1] - p.ms[k] > p.kind.gapMs) break
      trail.push([p.lon[k], p.lat[k], p.alt[k], p.spd[k], p.iso[k]])
    }
    trail.reverse()

    result[p.uid] = {
      uid: p.uid,
      source: 'replay',
      lat: lerp(p.lat),
      lon: lerp(p.lon),
      altMeters: lerp(p.alt),
      speedMs: lerp(p.spd),
      courseTrue: p.hdg[j] ?? p.hdg[i] ?? 0,
      type: p.kind.type,
      callsign: p.name,
      category: undefined,
      trail: trail.slice(-150),
      smoothedTrail: [],
      predictedPath: [],
    }
  }
  return result
}
