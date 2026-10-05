/**
 * Ground height for map overlays when 3D terrain is on.
 *
 * deck.gl draws the overlay in its own pass, so a [lon, lat] position sits at sea level: with the camera tilted over
 * relief, icons slide away from the ground they belong to. `lift` adds the terrain height (already scaled by the
 * exaggeration, as MapLibre reports it) as the third coordinate. With terrain off it returns the plain [lon, lat], so
 * the flat map is untouched.
 *
 * Heights are cached per ~55 m cell: a rebuild looks up every entity, and sampling the DEM for each one each time
 * would cost more than the rebuild. When elevation tiles load the cache is dropped and `terrainVersion()` moves on,
 * so layer groups that depend on it rebuild once per burst of tiles.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'

const CELLS_PER_DEGREE = 2000
const MAX_CACHED_CELLS = 200_000
const TERRAIN_SOURCE = 'terrain-dem'
const RETRY_MS = 1000
const RECHECK_MS = 2000
const RECHECK_SAMPLE = 40

export type Lifted = [number, number] | [number, number, number]

let map: MapLibreMap | null = null
let active = false
let exaggeration = 1
let version = 0
let misses = 0
const heights = new Map<number, number>()
// Cells that read exactly 0: either real sea level or a tile MapLibre has not decoded yet; rechecked on a timer.
const zeroCells = new Map<number, [number, number]>()
let detach: (() => void) | null = null

/** Changes whenever lifted positions may have changed (terrain on/off, exaggeration, newly loaded tiles). */
export function terrainVersion(): number { return version }
export function terrainActive(): boolean { return active }
export function terrainExaggerationNow(): number { return exaggeration }

/** Called by the terrain layer after it applies (or removes) the terrain. */
export function configureTerrainElevation(m: MapLibreMap | null, enabled: boolean, exag: number): void {
  detach?.()
  detach = null
  map = m
  active = Boolean(m) && enabled
  exaggeration = exag
  heights.clear()
  zeroCells.clear()
  misses = 0
  version++
  if (!m || !active) return
  let timer = 0
  const recheck = window.setInterval(() => {
    // A sample of the zero cells: if any has real height now, its tile arrived late, so start over.
    let changed = false
    let n = 0
    for (const [, [lon, lat]] of zeroCells) {
      if (n++ >= RECHECK_SAMPLE) break
      let h: number | null = null
      try { h = m.queryTerrainElevation([lon, lat]) } catch { h = null }
      if (typeof h === 'number' && Number.isFinite(h) && h !== 0) { changed = true; break }
    }
    if (changed) { heights.clear(); zeroCells.clear(); version++ }
  }, RECHECK_MS)
  // MapLibre answers 0 (not null) for a tile it has not decoded yet, so a cached height may be a placeholder: when
  // elevation tiles arrive, forget the cache and let overlay groups look their positions up again, once per burst.
  const onSourceData = (e: { sourceId?: string }) => {
    if (e.sourceId !== TERRAIN_SOURCE || timer) return
    timer = window.setTimeout(() => {
      timer = 0
      heights.clear()
      zeroCells.clear()
      misses = 0
      version++
    }, RETRY_MS)
  }
  m.on('sourcedata', onSourceData)
  detach = () => { m.off('sourcedata', onSourceData); window.clearInterval(recheck); if (timer) window.clearTimeout(timer) }
}

/** Terrain height at a point in metres (exaggeration applied); 0 when terrain is off or the tile is not loaded yet. */
export function terrainHeight(lon: number, lat: number): number {
  if (!active || !map) return 0
  const key = Math.round((lon + 180) * CELLS_PER_DEGREE) * 1_000_000 + Math.round((lat + 90) * CELLS_PER_DEGREE)
  const hit = heights.get(key)
  if (hit !== undefined) return hit
  if (zeroCells.has(key)) return 0
  let h: number | null = null
  try { h = map.queryTerrainElevation([lon, lat]) } catch { h = null }
  if (typeof h !== 'number' || !Number.isFinite(h)) { misses++; return 0 }
  if (h === 0) {
    if (zeroCells.size < MAX_CACHED_CELLS) zeroCells.set(key, [lon, lat])
    return 0
  }
  if (heights.size >= MAX_CACHED_CELLS) heights.clear()
  heights.set(key, h)
  return h
}

/** A deck.gl position for a ground point, `aboveGroundM` metres up (scaled with the terrain so clearance stays true). */
export function lift(lon: number, lat: number, aboveGroundM = 0): Lifted {
  if (!active) return [lon, lat]
  return [lon, lat, terrainHeight(lon, lat) + aboveGroundM * exaggeration]
}

/** A deck.gl position at an altitude above mean sea level (aircraft): never below the ground, scaled like the terrain. */
export function liftMsl(lon: number, lat: number, altitudeM: number): Lifted {
  if (!active) return [lon, lat]
  return [lon, lat, Math.max(altitudeM * exaggeration, terrainHeight(lon, lat))]
}

/** What the elevation lookup is doing, for the developer tools. */
export function terrainStats(): { active: boolean; exaggeration: number; cachedCells: number; pendingLookups: number } {
  return { active, exaggeration, cachedCells: heights.size + zeroCells.size, pendingLookups: misses }
}

/** Positions of an outline or path lifted onto the terrain; the same array comes back when terrain is off. */
export function liftRing<T extends number[]>(coords: T[]): T[] {
  return active ? coords.map(c => lift(c[0], c[1]) as unknown as T) : coords
}

/** One data position lifted onto the terrain (see `lift`). */
export function liftPos(p: number[]): number[] {
  return active ? lift(p[0], p[1]) : p
}
