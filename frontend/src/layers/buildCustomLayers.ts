import { PolygonLayer, LineLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'

export interface CustomLayerItem {
  id: number
  name: string
  geojson: object
  style: { color?: string; opacity?: number; line_color?: string; line_width?: number } | null
  visible: boolean
}

/**
 * Build Deck.gl layers for rendering custom user-imported GeoJSON layers.
 * Renders polygons, lines, and points with customizable styling (color, opacity).
 */
export function buildCustomLayers(customLayers: CustomLayerItem[]): Layer[] {
  const layers: Layer[] = []

  for (const layer of customLayers) {
    if (!layer.visible) continue

    const featureCollection = layer.geojson as any
    if (!featureCollection.features) continue

    const color = layer.style?.color ?? '#FFB800'
    const opacity = layer.style?.opacity ?? 0.25
    const lineColor = layer.style?.line_color ?? color
    const lineWidth = layer.style?.line_width ?? 1.5

    // Convert hex color to RGB
    const rgb = hexToRgb(color)
    const lineRgb = hexToRgb(lineColor)

    // Separate features by type
    const polygons: any[] = []
    const lines: any[] = []
    const points: any[] = []

    for (const feature of featureCollection.features) {
      const geom = feature.geometry
      if (!geom) continue

      const geomType = geom.type
      const coords = geom.coordinates

      if (geomType === 'Polygon') {
        polygons.push({
          id: `${layer.id}-poly-${polygons.length}`,
          polygon: coords[0], // exterior ring
          color: rgb,
        })
      } else if (geomType === 'MultiPolygon') {
        coords.forEach((poly: any, idx: number) => {
          polygons.push({
            id: `${layer.id}-multipoly-${idx}`,
            polygon: poly[0],
            color: rgb,
          })
        })
      } else if (geomType === 'LineString') {
        const lineCoords = coords as [number, number][]
        for (let i = 0; i < lineCoords.length - 1; i++) {
          lines.push({
            id: `${layer.id}-line-${i}`,
            sourcePosition: lineCoords[i],
            targetPosition: lineCoords[i + 1],
            color: lineRgb,
          })
        }
      } else if (geomType === 'MultiLineString') {
        coords.forEach((lineStr: any, lineIdx: number) => {
          for (let i = 0; i < lineStr.length - 1; i++) {
            lines.push({
              id: `${layer.id}-multiline-${lineIdx}-${i}`,
              sourcePosition: lineStr[i],
              targetPosition: lineStr[i + 1],
              color: lineRgb,
            })
          }
        })
      } else if (geomType === 'Point') {
        points.push({
          id: `${layer.id}-point`,
          position: coords,
          color: rgb,
        })
      } else if (geomType === 'MultiPoint') {
        coords.forEach((pt: any, idx: number) => {
          points.push({
            id: `${layer.id}-multipoint-${idx}`,
            position: pt,
            color: rgb,
          })
        })
      }
    }

    // Polygon layer
    if (polygons.length > 0) {
      layers.push(
        new PolygonLayer({
          id: `custom-polygon-${layer.id}`,
          data: polygons,
          getPolygon: (d: any) => d.polygon,
          getFillColor: (d: any) => [d.color[0], d.color[1], d.color[2], Math.floor(opacity * 40)] as [number, number, number, number],
          stroked: true,
          getLineColor: (d: any) => [d.color[0], d.color[1], d.color[2], Math.floor(opacity * 200)] as [number, number, number, number],
          getLineWidth: lineWidth,
          lineWidthUnits: 'pixels',
          pickable: true,
        })
      )
    }

    // Line layer
    if (lines.length > 0) {
      layers.push(
        new LineLayer({
          id: `custom-line-${layer.id}`,
          data: lines,
          getSourcePosition: (d: any) => d.sourcePosition,
          getTargetPosition: (d: any) => d.targetPosition,
          getColor: (d: any) => [d.color[0], d.color[1], d.color[2], Math.floor(opacity * 200)] as [number, number, number, number],
          getWidth: lineWidth,
          widthUnits: 'pixels',
          pickable: true,
        })
      )
    }

    // Point layer
    if (points.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: `custom-point-${layer.id}`,
          data: points,
          getPosition: (d: any) => d.position,
          getRadius: 5,
          radiusUnits: 'pixels',
          getFillColor: (d: any) => [d.color[0], d.color[1], d.color[2], Math.floor(opacity * 220)] as [number, number, number, number],
          getLineColor: [0, 0, 0, 180] as [number, number, number, number],
          getLineWidth: 1,
          lineWidthUnits: 'pixels',
          pickable: true,
        })
      )
    }
  }

  return layers
}

/**
 * Convert hex color string (#RRGGBB or #RGB) to RGB tuple [R, G, B].
 */
function hexToRgb(hex: string): [number, number, number] {
  hex = hex.replace('#', '')
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('')
  }
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return [255, 184, 0]
  return [r, g, b]
}
