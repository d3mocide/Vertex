import { PathLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'

export type TransitRoute = { type: 'bus' | 'train'; lines: [number, number][][] }

export function buildTransitRouteLayers(route: TransitRoute | null): Layer[] {
  if (!route) return []
  const color: [number, number, number, number] = route.type === 'bus'
    ? [255, 229, 132, 235] : [255, 193, 7, 235]
  const lines = route.lines.filter(line => line.length >= 2)
  if (!lines.length) return []
  return [
    new PathLayer({ id: 'selected-transit-route-glow', data: lines,
      getPath: line => line, getColor: [color[0], color[1], color[2], 65], getWidth: 9,
      widthUnits: 'pixels', capRounded: true, jointRounded: true, pickable: false }),
    new PathLayer({ id: 'selected-transit-route', data: lines,
      getPath: line => line, getColor: color, getWidth: 3,
      widthUnits: 'pixels', capRounded: true, jointRounded: true, pickable: false }),
  ]
}
