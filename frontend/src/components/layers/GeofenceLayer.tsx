import { useEffect, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

interface Props { map: maplibregl.Map }

const SRC_DRAW   = 'geofence-draw'

function buildCirclePolygon(center: [number, number], edge: [number, number], steps = 48): [number, number][] {
  const [centerLon, centerLat] = center
  const [edgeLon, edgeLat] = edge
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(edgeLat - centerLat)
  const dLon = toRad(edgeLon - centerLon)
  const lat1 = toRad(centerLat)
  const lat2 = toRad(edgeLat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  const radiusM = 2 * 6371000 * Math.asin(Math.sqrt(h))

  const latScale = 1 / 111_320.0
  const lonScale = 1 / Math.max(111_320.0 * Math.cos(toRad(centerLat)), 1e-6)
  const pts: [number, number][] = []
  for (let i = 0; i < steps; i++) {
    const a = 2 * Math.PI * (i / steps)
    const dLatM = Math.sin(a) * radiusM
    const dLonM = Math.cos(a) * radiusM
    pts.push([centerLon + dLonM * lonScale, centerLat + dLatM * latScale])
  }
  pts.push(pts[0])
  return pts
}

function buildDrawGeoJSON(points: [number, number][], mode: 'polygon' | 'circle'): GeoJSON.FeatureCollection {
  if (points.length === 0) {
    return { type: 'FeatureCollection', features: [] }
  }

  const features: GeoJSON.Feature[] = []

  if (mode === 'circle') {
    for (const pt of points) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pt },
        properties: {},
      })
    }
    if (points.length >= 2) {
      const ring = buildCirclePolygon(points[0], points[1])
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {},
      })
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [points[0], points[1]] },
        properties: {},
      })
    }
    return { type: 'FeatureCollection', features }
  }

  // Line connecting the points
  if (points.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [...points, points[0]],  // close preview
      },
      properties: {},
    })
  }

  // Vertex dots
  for (const pt of points) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: pt },
      properties: {},
    })
  }

  // Fill preview (needs ≥3 points)
  if (points.length >= 3) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[...points, points[0]]],
      },
      properties: {},
    })
  }

  return { type: 'FeatureCollection', features }
}

export function GeofenceLayer({ map }: Props) {
  const geofenceDrawing    = useCivicStore((s) => s.geofenceDrawing)
  const geofenceDrawMode   = useCivicStore((s) => s.geofenceDrawMode)
  const geofenceDrawPoints = useCivicStore((s) => s.geofenceDrawPoints)
  const addGeofenceDrawPoint = useCivicStore((s) => s.addGeofenceDrawPoint)

  // Draw preview layer
  useEffect(() => {
    const drawGeoJSON = buildDrawGeoJSON(geofenceDrawPoints, geofenceDrawMode)

    if (!map.getSource(SRC_DRAW)) {
      map.addSource(SRC_DRAW, { type: 'geojson', data: drawGeoJSON })
      map.addLayer({
        id: 'draw-fill',
        type: 'fill',
        source: SRC_DRAW,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#ffd700', 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: 'draw-line',
        type: 'line',
        source: SRC_DRAW,
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': '#ffd700', 'line-width': 2 },
      })
      map.addLayer({
        id: 'draw-points',
        type: 'circle',
        source: SRC_DRAW,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffd700',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff',
        },
      })
    } else {
      (map.getSource(SRC_DRAW) as maplibregl.GeoJSONSource).setData(drawGeoJSON)
    }
  }, [geofenceDrawPoints, geofenceDrawMode, map])

  // Map click handler for draw mode
  const handleMapClick = useCallback((e: maplibregl.MapMouseEvent) => {
    addGeofenceDrawPoint([e.lngLat.lng, e.lngLat.lat])
  }, [addGeofenceDrawPoint])

  useEffect(() => {
    if (geofenceDrawing) {
      map.getCanvas().style.cursor = 'crosshair'
      map.on('click', handleMapClick)
    } else {
      map.getCanvas().style.cursor = ''
      map.off('click', handleMapClick)
    }
    return () => {
      map.getCanvas().style.cursor = ''
      map.off('click', handleMapClick)
    }
  }, [geofenceDrawing, map, handleMapClick])

  return null
}

// Exported helper for GeofencePanel to trigger a layer reload
export function reloadGeofences(map: maplibregl.Map) {
  void map
  fetch(`${API_BASE}/geofences`, { headers: authHeaders() })
    .then(() => {})
    .catch(() => {})
}
