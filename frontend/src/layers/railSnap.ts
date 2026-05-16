export type RailSegment = {
  aLon: number
  aLat: number
  bLon: number
  bLat: number
}

type GeoJsonGeometry = {
  type: string
  coordinates: unknown
}

type GeoJsonFeature = {
  type: string
  geometry?: GeoJsonGeometry | null
}

type GeoJsonFeatureCollection = {
  type: string
  features?: GeoJsonFeature[]
}

const METERS_PER_DEG_LAT = 110_540

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function toLonLat(point: unknown): [number, number] | null {
  if (!Array.isArray(point) || point.length < 2) return null
  const lon = point[0]
  const lat = point[1]
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) return null
  return [lon, lat]
}

function pushLineSegments(coords: unknown, out: RailSegment[]): void {
  if (!Array.isArray(coords) || coords.length < 2) return
  for (let i = 1; i < coords.length; i++) {
    const a = toLonLat(coords[i - 1])
    const b = toLonLat(coords[i])
    if (!a || !b) continue
    out.push({ aLon: a[0], aLat: a[1], bLon: b[0], bLat: b[1] })
  }
}

export function extractRailSegments(geojson: unknown): RailSegment[] {
  const fc = geojson as GeoJsonFeatureCollection
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return []

  const segments: RailSegment[] = []
  for (const feature of fc.features) {
    const geom = feature?.geometry
    if (!geom || !geom.type) continue

    if (geom.type === 'LineString') {
      pushLineSegments(geom.coordinates, segments)
      continue
    }

    if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
      for (const line of geom.coordinates) pushLineSegments(line, segments)
    }
  }
  return segments
}

export function snapPointToRail(
  lon: number,
  lat: number,
  segments: RailSegment[],
  maxSnapMeters: number,
): { lon: number; lat: number; distanceMeters: number } | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || segments.length === 0) return null

  const cosLat = Math.cos((lat * Math.PI) / 180)
  const metersPerDegLon = 111_320 * Math.max(0.2, Math.abs(cosLat))

  let bestDistanceM = Number.POSITIVE_INFINITY
  let bestLon = lon
  let bestLat = lat

  for (const seg of segments) {
    const ax = (seg.aLon - lon) * metersPerDegLon
    const ay = (seg.aLat - lat) * METERS_PER_DEG_LAT
    const bx = (seg.bLon - lon) * metersPerDegLon
    const by = (seg.bLat - lat) * METERS_PER_DEG_LAT

    const abx = bx - ax
    const aby = by - ay
    const abLen2 = abx * abx + aby * aby
    if (abLen2 <= 1e-6) continue

    const tRaw = (-(ax * abx + ay * aby)) / abLen2
    const t = Math.max(0, Math.min(1, tRaw))

    const px = ax + abx * t
    const py = ay + aby * t
    const d = Math.hypot(px, py)

    if (d < bestDistanceM) {
      bestDistanceM = d
      bestLon = seg.aLon + (seg.bLon - seg.aLon) * t
      bestLat = seg.aLat + (seg.bLat - seg.aLat) * t
    }
  }

  if (!Number.isFinite(bestDistanceM) || bestDistanceM > maxSnapMeters) return null
  return { lon: bestLon, lat: bestLat, distanceMeters: bestDistanceM }
}
