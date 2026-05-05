import { PolygonLayer, LineLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import { destinationPoint } from './geoUtils'

/**
 * Build Deck.gl layers for the observation range ring (coverage area).
 * Renders a circle centered at the region's default center with the configured observation radius.
 */
export function buildObservationRingLayers(
  center: [number, number],
  radiusKm: number,
  visible: boolean,
): Layer[] {
  if (!radiusKm) return []

  // Build circle polygon
  const ring: [number, number][] = []
  const steps = 128
  for (let i = 0; i <= steps; i++) {
    const bearing = (i * 360) / steps
    ring.push(destinationPoint(center[0], center[1], bearing, radiusKm * 1_000))
  }

  const data = [
    {
      id: 'obs-ring',
      polygon: ring,
    },
  ]

  return [
    new PolygonLayer({
      id: 'observation-ring-fill',
      data,
      getPolygon: (d: any) => d.polygon,
      getFillColor: [100, 200, 255, 15] as [number, number, number, number],
      stroked: true,
      getLineColor: [100, 200, 255, 100] as [number, number, number, number],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      pickable: false,
      visible,
    }),
  ]
}
