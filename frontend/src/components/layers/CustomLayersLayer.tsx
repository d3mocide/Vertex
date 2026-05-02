import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore, CustomLayerItem } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

interface Props {
  map: maplibregl.Map
}

function sourceId(id: number) { return `custom-layer-${id}` }
function fillId(id: number)   { return `custom-layer-fill-${id}` }
function lineId(id: number)   { return `custom-layer-line-${id}` }
function circleId(id: number) { return `custom-layer-circle-${id}` }

function removeLayers(map: maplibregl.Map, id: number) {
  for (const layerId of [fillId(id), lineId(id), circleId(id)]) {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
  }
  if (map.getSource(sourceId(id))) map.removeSource(sourceId(id))
}

function addLayers(map: maplibregl.Map, layer: CustomLayerItem) {
  const src = sourceId(layer.id)
  const color  = layer.style?.color       ?? '#FFB800'
  const opacity = layer.style?.opacity    ?? 0.25
  const lineColor = layer.style?.line_color ?? color
  const lineWidth = layer.style?.line_width ?? 1.5
  const vis: 'visible' | 'none' = layer.visible ? 'visible' : 'none'

  if (!map.getSource(src)) {
    map.addSource(src, { type: 'geojson', data: layer.geojson as GeoJSON.GeoJSON })
  } else {
    (map.getSource(src) as maplibregl.GeoJSONSource).setData(layer.geojson as GeoJSON.GeoJSON)
  }

  if (!map.getLayer(fillId(layer.id))) {
    map.addLayer({
      id: fillId(layer.id),
      type: 'fill',
      source: src,
      filter: ['==', ['geometry-type'], 'Polygon'],
      layout: { visibility: vis },
      paint: { 'fill-color': color, 'fill-opacity': opacity },
    })
  } else {
    map.setLayoutProperty(fillId(layer.id), 'visibility', vis)
  }

  if (!map.getLayer(lineId(layer.id))) {
    map.addLayer({
      id: lineId(layer.id),
      type: 'line',
      source: src,
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'LineString', 'MultiLineString', 'MultiPolygon']]],
      layout: { visibility: vis },
      paint: { 'line-color': lineColor, 'line-width': lineWidth, 'line-opacity': Math.min(1, opacity * 3) },
    })
  } else {
    map.setLayoutProperty(lineId(layer.id), 'visibility', vis)
  }

  if (!map.getLayer(circleId(layer.id))) {
    map.addLayer({
      id: circleId(layer.id),
      type: 'circle',
      source: src,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { visibility: vis },
      paint: { 'circle-color': color, 'circle-radius': 5, 'circle-opacity': Math.min(1, opacity * 2) },
    })
  } else {
    map.setLayoutProperty(circleId(layer.id), 'visibility', vis)
  }
}

export function CustomLayersLayer({ map }: Props) {
  const { customLayers, setCustomLayers } = useCivicStore()
  const renderedIds = useRef<Set<number>>(new Set())

  // Fetch layers from API and sync to store
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/layers`, { headers: authHeaders() })
        if (res.ok && !cancelled) setCustomLayers(await res.json())
      } catch { /* ignore */ }
    }
    load()
    const interval = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [setCustomLayers])

  // Sync MapLibre sources/layers whenever customLayers changes
  useEffect(() => {
    if (!map.isStyleLoaded()) return

    const currentIds = new Set(customLayers.map((l) => l.id))

    // Remove layers that no longer exist
    for (const id of renderedIds.current) {
      if (!currentIds.has(id)) {
        removeLayers(map, id)
        renderedIds.current.delete(id)
      }
    }

    // Add or update layers
    for (const layer of customLayers) {
      addLayers(map, layer)
      renderedIds.current.add(layer.id)
    }
  }, [map, customLayers])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const id of renderedIds.current) {
        removeLayers(map, id)
      }
      renderedIds.current.clear()
    }
  }, [map])

  return null
}
