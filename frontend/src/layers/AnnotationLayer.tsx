import { ScatterplotLayer, LineLayer, PolygonLayer, TextLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'
import type { AnnotationItem } from '../storeTypes'

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '')
  const r = parseInt(cleaned.slice(0, 2), 16)
  const g = parseInt(cleaned.slice(2, 4), 16)
  const b = parseInt(cleaned.slice(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return [255, 184, 0] // fallback to amber
  return [r, g, b]
}

interface AnnotationGeometry {
  type: 'Point' | 'LineString' | 'Polygon'
  coordinates: number[] | number[][] | number[][][]
}

/**
 * Build Deck.gl layers from saved annotations.
 * Renders markers (ScatterplotLayer), lines (LineLayer), and polygons (PolygonLayer),
 * plus text labels (TextLayer).
 */
export function buildAnnotationLayers(annotations: AnnotationItem[], visible: boolean): Layer[] {
  const markerData: Array<{
    position: [number, number]
    id: number
    label: string | null
    color: [number, number, number]
  }> = []

  const lineData: Array<{
    sourcePosition: [number, number]
    targetPosition: [number, number]
    id: number
    color: [number, number, number]
  }> = []

  const polyData: Array<{
    polygon: [number, number][]
    id: number
    color: [number, number, number]
  }> = []

  const labelData: Array<{
    position: [number, number]
    text: string
    color: [number, number, number]
  }> = []

  for (const annot of annotations) {
    if (!annot.geojson) continue
    const geom = annot.geojson as AnnotationGeometry
    const color = hexToRgb(annot.color)
    const label = annot.label || ''

    switch (annot.annotation_type) {
      case 'marker': {
        const coords = geom.coordinates as [number, number]
        markerData.push({ position: coords, id: annot.id, label, color })
        if (label) {
          labelData.push({ position: coords, text: label, color })
        }
        break
      }

      case 'line': {
        const coords = geom.coordinates as [number, number][]
        for (let i = 0; i < coords.length - 1; i++) {
          lineData.push({
            sourcePosition: coords[i],
            targetPosition: coords[i + 1],
            id: annot.id,
            color,
          })
        }
        // Label at midpoint
        if (label && coords.length > 0) {
          const mid = coords[Math.floor(coords.length / 2)]
          labelData.push({ position: mid, text: label, color })
        }
        break
      }

      case 'polygon': {
        const coords = (geom.coordinates as [number, number][][])[0]
        if (coords && coords.length > 0) {
          polyData.push({ polygon: coords, id: annot.id, color })
          // Label at centroid
          if (label) {
            const sumLon = coords.reduce((sum, c) => sum + c[0], 0)
            const sumLat = coords.reduce((sum, c) => sum + c[1], 0)
            const centroid: [number, number] = [sumLon / coords.length, sumLat / coords.length]
            labelData.push({ position: centroid, text: label, color })
          }
        }
        break
      }
    }
  }

  const layers: Layer[] = []

  // Polygon fill layer
  if (polyData.length > 0) {
    layers.push(
      new PolygonLayer({
        id: 'annotation-polygon',
        data: polyData,
        getPolygon: (d: any) => d.polygon,
        getFillColor: (d: any) => [d.color[0], d.color[1], d.color[2], 40] as [number, number, number, number],
        stroked: true,
        getLineColor: (d: any) => [d.color[0], d.color[1], d.color[2], 200] as [number, number, number, number],
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        pickable: true,
        visible,
      })
    )
  }

  // Line layer
  if (lineData.length > 0) {
    layers.push(
      new LineLayer({
        id: 'annotation-line',
        data: lineData,
        getSourcePosition: (d: any) => d.sourcePosition,
        getTargetPosition: (d: any) => d.targetPosition,
        getColor: (d: any) => [d.color[0], d.color[1], d.color[2], 200] as [number, number, number, number],
        getWidth: 2,
        widthUnits: 'pixels',
        pickable: true,
        visible,
      })
    )
  }

  // Marker layer
  if (markerData.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: 'annotation-marker',
        data: markerData,
        getPosition: (d: any) => d.position,
        getRadius: 6,
        radiusUnits: 'pixels',
        getFillColor: (d: any) => [d.color[0], d.color[1], d.color[2], 220] as [number, number, number, number],
        getLineColor: [0, 0, 0, 200] as [number, number, number, number],
        getLineWidth: 1,
        lineWidthUnits: 'pixels',
        pickable: true,
        visible,
      })
    )
  }

  // Text labels layer
  if (labelData.length > 0) {
    layers.push(
      new TextLayer({
        id: 'annotation-label',
        data: labelData,
        getPosition: (d: any) => d.position,
        getText: (d: any) => d.text,
        getSize: 11,
        getColor: (d: any) => [d.color[0], d.color[1], d.color[2], 255] as [number, number, number, number],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        getAngle: 0,
        sizeUnits: 'pixels',
        pickable: false,
        visible,
      })
    )
  }

  return layers
}
