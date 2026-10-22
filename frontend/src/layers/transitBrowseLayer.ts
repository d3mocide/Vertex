import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import type { TransitRouteDetail, TransitStop } from '../storeTypes'

type Rgba = [number, number, number, number]

/** Publisher colour (`#rrggbb`) as deck.gl RGB; amber-gold when the agency gave none. */
function routeColor(hex: string | null, alpha: number): Rgba {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '')
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), alpha] : [255, 184, 0, alpha]
}

/** Every distinct stop of a route, in either direction. */
export function browseStops(detail: TransitRouteDetail): TransitStop[] {
  const seen = new Map<string, TransitStop>()
  for (const d of detail.directions) for (const s of d.stops) if (!seen.has(s.id)) seen.set(s.id, s)
  return [...seen.values()]
}

/** [west, south, east, north] of the route's line, or null when it has no geometry. */
export function browseBounds(detail: TransitRouteDetail): [number, number, number, number] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const line of detail.geometry.coordinates) for (const [lon, lat] of line) {
    if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat
  }
  return Number.isFinite(w) ? [w, s, e, n] : null
}

/** The route and stops picked in the transit browser; the chosen stop is ringed in the signal accent. */
export function buildTransitBrowseLayers(detail: TransitRouteDetail | null, stopId: string | null, zoom: number): Layer[] {
  if (!detail) return []
  const color = routeColor(detail.route.color, 235)
  const lines = detail.geometry.coordinates.filter(line => line.length >= 2)
  const stops = browseStops(detail)
  const chosen = stops.filter(s => s.id === stopId)
  const layers: Layer[] = []
  if (lines.length) layers.push(
    new PathLayer({ id: 'transit-browse-glow', data: lines, getPath: line => line,
      getColor: [color[0], color[1], color[2], 70], getWidth: 10, widthUnits: 'pixels',
      capRounded: true, jointRounded: true, pickable: false }),
    new PathLayer({ id: 'transit-browse-route', data: lines, getPath: line => line,
      getColor: color, getWidth: 4, widthUnits: 'pixels',
      capRounded: true, jointRounded: true, pickable: false }),
  )
  layers.push(new ScatterplotLayer<TransitStop>({ id: 'transit-browse-stops', data: stops,
    getPosition: s => [s.lon, s.lat], getFillColor: [5, 5, 5, 255], getLineColor: color,
    stroked: true, filled: true, getLineWidth: 2, lineWidthUnits: 'pixels',
    radiusUnits: 'pixels', getRadius: zoom >= 13 ? 5 : zoom >= 11 ? 3.5 : 2.5, pickable: false }))
  if (chosen.length) layers.push(new ScatterplotLayer<TransitStop>({ id: 'transit-browse-stop-chosen', data: chosen,
    getPosition: s => [s.lon, s.lat], getFillColor: [255, 184, 0, 255], getLineColor: [242, 242, 242, 255],
    stroked: true, filled: true, getLineWidth: 2, lineWidthUnits: 'pixels',
    radiusUnits: 'pixels', getRadius: 8, pickable: false }))
  return layers
}
