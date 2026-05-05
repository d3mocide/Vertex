import { PolygonLayer, LineLayer } from '@deck.gl/layers'
import type { Layer } from '@deck.gl/core'

export interface GeofenceItem {
  id: number
  name: string
  zone_type: string
  active: boolean
  geojson_polygon: GeoJSON.Geometry
}

const ZONE_COLORS: Record<string, [number, number, number]> = {
  alert: [255, 184, 0],      // amber-gold: #FFB800
  exclusion: [255, 59, 48],  // red-emergency: #FF3B30
  info: [79, 195, 247],      // cyan-adsb: #4FC3F7
}

/**
 * Build Deck.gl layers for rendering geofence polygons (saved alert zones).
 * Renders zone fill and outlines with semantic color coding (alert/exclusion/info).
 */
export function buildGeofenceLayers(
  geofences: GeofenceItem[],
  visible: boolean,
): Layer[] {
  if (!geofences.length) return []

  const layers: Layer[] = []

  // Filter to active geofences only
  const active = geofences.filter((g) => g.active)
  if (!active.length) return []

  // Transform GeoJSON geometries to Deck.gl polygon format
  const polyData = active
    .filter((g) => {
      const geom = g.geojson_polygon as any
      return geom.type === 'Polygon' || geom.type === 'MultiPolygon'
    })
    .flatMap((g) => {
      const geom = g.geojson_polygon as any
      const color = ZONE_COLORS[g.zone_type] || ZONE_COLORS.alert
      const coords = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat(1)

      return coords.map((ring: [number, number][]) => ({
        id: g.id,
        name: g.name,
        zone_type: g.zone_type,
        color,
        polygon: ring,
      }))
    })

  // Fill layer
  if (polyData.length > 0) {
    layers.push(
      new PolygonLayer({
        id: 'geofence-fill',
        data: polyData,
        getPolygon: (d: any) => d.polygon,
        getFillColor: (d: any) => [d.color[0], d.color[1], d.color[2], 20] as [number, number, number, number],
        stroked: true,
        getLineColor: (d: any) => [d.color[0], d.color[1], d.color[2], 180] as [number, number, number, number],
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
        pickable: true,
        visible,
      })
    )
  }

  return layers
}
