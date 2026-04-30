const R = 6_371_000

export function chaikinSmooth(pts: number[][], iterations = 2): number[][] {
  if (pts.length < 3) return pts
  let out = pts
  for (let k = 0; k < iterations; k++) {
    const next: number[][] = [out[0]]
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1]
      const dims = a.length
      next.push(
        Array.from({ length: dims }, (_, d) => 0.75 * a[d] + 0.25 * b[d]),
        Array.from({ length: dims }, (_, d) => 0.25 * a[d] + 0.75 * b[d]),
      )
    }
    next.push(out[out.length - 1])
    out = next
  }
  return out
}

/**
 * Remove spike points from a trail — points where the bearing from the
 * previous segment to the next flips by more than maxAngleDeg degrees.
 *
 * Aircraft cannot instantaneously reverse direction, so any point that
 * creates a near-180° bearing reversal is a CPR decode artifact ("hook"
 * or "out-and-back" glitch). We strip it so Chaikin has clean input.
 *
 * pts: [[lon, lat], ...] or [[lon, lat, ...], ...]
 */
export function filterTrailSpikes(pts: number[][], maxAngleDeg = 120): number[][] {
  if (pts.length < 3) return pts

  function bearing(ax: number, ay: number, bx: number, by: number): number {
    const dLon = bx - ax
    const dLat = by - ay
    return Math.atan2(dLon, dLat) * (180 / Math.PI)
  }

  function angleDiff(a: number, b: number): number {
    return Math.abs(((b - a + 180 + 360) % 360) - 180)
  }

  const out: number[][] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1]
    const curr = pts[i]
    const next = pts[i + 1]
    const bearIn  = bearing(prev[0], prev[1], curr[0], curr[1])
    const bearOut = bearing(curr[0], curr[1], next[0], next[1])
    // Keep the point unless both segments disagree sharply (spike pattern).
    if (angleDiff(bearIn, bearOut) <= maxAngleDeg) {
      out.push(curr)
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

export function getDistanceMeters(
  lon1: number, lat1: number,
  lon2: number, lat2: number,
): number {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function getBearing(
  lon1: number, lat1: number,
  lon2: number, lat2: number,
): number {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180
  const Δψ = Math.log(Math.tan(φ2 / 2 + Math.PI / 4) / Math.tan(φ1 / 2 + Math.PI / 4))
  const θ = Math.atan2(Δλ, Δψ) * 180 / Math.PI
  return (θ + 360) % 360
}

export function destinationPoint(
  lon: number, lat: number,
  bearingDeg: number, distMeters: number,
): [number, number] {
  const φ1 = lat * Math.PI / 180
  const λ1 = lon * Math.PI / 180
  const θ  = bearingDeg * Math.PI / 180
  const δ  = distMeters / R
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  )
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
  )
  return [(λ2 * 180 / Math.PI + 540) % 360 - 180, φ2 * 180 / Math.PI]
}
