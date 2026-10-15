import { PolygonLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import type { NwrArea } from '../storeTypes'
import { liftRing, terrainVersion } from './terrainElevation'

// Tier A (immediate-threat warnings) is an emergency: red-emergency #C62828. Watches and advisories are an
// active alert: amber-gold #FFB800.
const WARNING_RGB: [number, number, number] = [198, 40, 40]
const ADVISORY_RGB: [number, number, number] = [255, 184, 0]

interface Ring {
  event: string
  ugc: string
  color: [number, number, number]
  polygon: [number, number][]
}

/**
 * County outlines for alerts heard on NOAA Weather Radio that the NWS feed does not list yet (the NWS alerts
 * layer draws the ones it knows). Always on while such an alert is active: it is rare and it is a warning.
 */
export function buildNwrAreaLayers(areas: NwrArea[], nowMs: number): Layer[] {
  const rings: Ring[] = []
  for (const area of areas) {
    const expires = area.expires ? Date.parse(area.expires) : NaN
    if (Number.isFinite(expires) && expires <= nowMs) continue
    const color = area.severity === 'Severe' ? WARNING_RGB : ADVISORY_RGB
    const polys = area.geometry.type === 'Polygon' ? [area.geometry.coordinates] : area.geometry.coordinates
    for (const poly of polys) {
      for (const ring of poly) rings.push({ event: area.event, ugc: area.ugc, color, polygon: ring as [number, number][] })
    }
  }
  if (rings.length === 0) return []

  return [
    new PolygonLayer<Ring>({
      id: 'nwr-area',
      data: rings,
      updateTriggers: { getPolygon: terrainVersion() },
      getPolygon: (d) => liftRing(d.polygon),
      getFillColor: (d) => [d.color[0], d.color[1], d.color[2], 28],
      stroked: true,
      getLineColor: (d) => [d.color[0], d.color[1], d.color[2], 230],
      getLineWidth: 2.5,
      lineWidthUnits: 'pixels',
      pickable: false,
    }),
  ]
}
