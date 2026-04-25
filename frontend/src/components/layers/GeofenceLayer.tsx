import { useEffect, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

interface Props { map: maplibregl.Map }

interface GeofenceRecord {
  id: number
  name: string
  zone_type: string
  active: boolean
  geojson_polygon: GeoJSON.Geometry
}

const SRC_FENCES = 'geofences'
const SRC_DRAW   = 'geofence-draw'

const ZONE_COLORS: Record<string, string> = {
  alert:     '#ffd700',
  exclusion: '#ff3b30',
  info:      '#4fc3f7',
}

function zoneColor(zt: string) { return ZONE_COLORS[zt] ?? ZONE_COLORS.alert }

function buildDrawGeoJSON(points: [number, number][]): GeoJSON.FeatureCollection {
  if (points.length === 0) {
    return { type: 'FeatureCollection', features: [] }
  }

  const features: GeoJSON.Feature[] = []

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
  const geofenceDrawPoints = useCivicStore((s) => s.geofenceDrawPoints)
  const geofencesVisible   = useCivicStore((s) => s.geofencesVisible)
  const addGeofenceDrawPoint = useCivicStore((s) => s.addGeofenceDrawPoint)
  const fencesRef = useRef<GeofenceRecord[]>([])

  // Load geofences from API
  useEffect(() => {
    fetch(`${API_BASE}/geofences`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data: GeofenceRecord[]) => {
        fencesRef.current = data
        updateFencesLayer(data)
      })
      .catch(() => {})
  }, [map])

  function updateFencesLayer(fences: GeofenceRecord[]) {
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: fences.map((f) => ({
        type: 'Feature',
        geometry: f.geojson_polygon,
        properties: { name: f.name, zone_type: f.zone_type },
      })),
    }

    if (!map.getSource(SRC_FENCES)) {
      map.addSource(SRC_FENCES, { type: 'geojson', data: geojson })
      map.addLayer({
        id: 'geofences-fill',
        type: 'fill',
        source: SRC_FENCES,
        paint: {
          'fill-color': [
            'match', ['get', 'zone_type'],
            'alert', ZONE_COLORS.alert,
            'exclusion', ZONE_COLORS.exclusion,
            'info', ZONE_COLORS.info,
            ZONE_COLORS.alert,
          ],
          'fill-opacity': 0.08,
        },
      })
      map.addLayer({
        id: 'geofences-line',
        type: 'line',
        source: SRC_FENCES,
        paint: {
          'line-color': [
            'match', ['get', 'zone_type'],
            'alert', ZONE_COLORS.alert,
            'exclusion', ZONE_COLORS.exclusion,
            'info', ZONE_COLORS.info,
            ZONE_COLORS.alert,
          ],
          'line-width': 1.5,
          'line-dasharray': [4, 2],
        },
      })
    } else {
      (map.getSource(SRC_FENCES) as maplibregl.GeoJSONSource).setData(geojson)
    }
  }

  // Toggle visibility
  useEffect(() => {
    const visibility = geofencesVisible ? 'visible' : 'none'
    if (map.getLayer('geofences-fill')) map.setLayoutProperty('geofences-fill', 'visibility', visibility)
    if (map.getLayer('geofences-line')) map.setLayoutProperty('geofences-line', 'visibility', visibility)
  }, [geofencesVisible, map])

  // Draw preview layer
  useEffect(() => {
    const drawGeoJSON = buildDrawGeoJSON(geofenceDrawPoints)

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
  }, [geofenceDrawPoints, map])

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
  fetch(`${API_BASE}/geofences`, { headers: authHeaders() })
    .then((r) => r.json())
    .then((data: GeofenceRecord[]) => {
      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: data.map((f) => ({
          type: 'Feature',
          geometry: f.geojson_polygon,
          properties: { name: f.name, zone_type: f.zone_type },
        })),
      }
      const src = map.getSource('geofences') as maplibregl.GeoJSONSource | undefined
      src?.setData(geojson)
    })
    .catch(() => {})
}
