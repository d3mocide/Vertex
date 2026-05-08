import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useEntitiesByType } from '../../hooks/useEntities'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

const SAT_SRC        = 'tinygs-satellites'
const SAT_GLOW       = 'tinygs-satellite-glow'
const SAT_DOT        = 'tinygs-satellite-dot'
const SAT_LABEL      = 'tinygs-satellite-label'

const STN_SRC        = 'tinygs-stations'
const STN_RING       = 'tinygs-station-ring'
const STN_DOT        = 'tinygs-station-dot'

const SAT_COLOR  = '#9E6CFF'
const SAT_LABEL_COLOR = '#C4A8FF'
const STN_COLOR  = '#FF8F00'

export function TinyGSLayer({ map }: Props) {
  const satellites    = useEntitiesByType('satellite')
  const stations      = useEntitiesByType('tinygs_station')
  const filterSat     = useCivicStore((s) => s.entityFilter.satellite)
  const filterStn     = useCivicStore((s) => s.entityFilter.tinygs_station)
  const selectEntity  = useCivicStore((s) => s.selectEntity)

  // ── Satellite layer setup / teardown ──────────────────────────────────────
  useEffect(() => {
    const handleClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (f?.properties?.id) selectEntity(f.properties.id as string)
    }
    const handleEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const handleLeave = () => { map.getCanvas().style.cursor = '' }

    if (!map.getSource(SAT_SRC)) {
      map.addSource(SAT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: SAT_GLOW, type: 'circle', source: SAT_SRC, paint: { 'circle-radius': 16, 'circle-color': SAT_COLOR, 'circle-opacity': 0.15 } })
      map.addLayer({ id: SAT_DOT, type: 'circle', source: SAT_SRC, paint: { 'circle-radius': 5, 'circle-color': SAT_COLOR, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } })
      map.addLayer({
        id: SAT_LABEL, type: 'symbol', source: SAT_SRC,
        layout: {
          'text-field': ['case', ['has', 'alt'], ['concat', ['get', 'name'], '\n', ['to-string', ['get', 'alt']], ' km'], ['get', 'name']],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size': 10, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-max-width': 10,
        },
        paint: { 'text-color': SAT_LABEL_COLOR, 'text-halo-color': '#050505', 'text-halo-width': 1.2 },
      })
      map.on('click', SAT_DOT, handleClick)
      map.on('mouseenter', SAT_DOT, handleEnter)
      map.on('mouseleave', SAT_DOT, handleLeave)
    }

    return () => {
      map.off('click', SAT_DOT, handleClick)
      map.off('mouseenter', SAT_DOT, handleEnter)
      map.off('mouseleave', SAT_DOT, handleLeave)
      if (map.getLayer(SAT_LABEL)) map.removeLayer(SAT_LABEL)
      if (map.getLayer(SAT_DOT))   map.removeLayer(SAT_DOT)
      if (map.getLayer(SAT_GLOW))  map.removeLayer(SAT_GLOW)
      if (map.getSource(SAT_SRC))  map.removeSource(SAT_SRC)
    }
  }, [map, selectEntity])

  // ── Satellite data updates ─────────────────────────────────────────────────
  useEffect(() => {
    const src = map.getSource(SAT_SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return
    const visible = filterSat ? satellites : []
    src.setData({
      type: 'FeatureCollection',
      features: visible.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon!, s.lat!] },
        properties: { id: s.entity_id, name: s.display_name ?? s.entity_id, ...(s.altitude != null && { alt: Math.round(s.altitude / 1000) }) },
      })),
    })
  }, [satellites, map, filterSat])

  // ── Station layer setup / teardown ────────────────────────────────────────
  useEffect(() => {
    const handleClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (f?.properties?.id) selectEntity(f.properties.id as string)
    }
    const handleEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const handleLeave = () => { map.getCanvas().style.cursor = '' }

    if (!map.getSource(STN_SRC)) {
      map.addSource(STN_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: STN_RING, type: 'circle', source: STN_SRC, paint: { 'circle-radius': 9, 'circle-color': ['case', ['get', 'online'], STN_COLOR, '#555'], 'circle-opacity': 0.25 } })
      map.addLayer({ id: STN_DOT, type: 'circle', source: STN_SRC, paint: { 'circle-radius': 5, 'circle-color': ['case', ['get', 'online'], STN_COLOR, '#888'], 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } })
      map.on('click', STN_DOT, handleClick)
      map.on('mouseenter', STN_DOT, handleEnter)
      map.on('mouseleave', STN_DOT, handleLeave)
    }

    return () => {
      map.off('click', STN_DOT, handleClick)
      map.off('mouseenter', STN_DOT, handleEnter)
      map.off('mouseleave', STN_DOT, handleLeave)
      if (map.getLayer(STN_DOT))  map.removeLayer(STN_DOT)
      if (map.getLayer(STN_RING)) map.removeLayer(STN_RING)
      if (map.getSource(STN_SRC)) map.removeSource(STN_SRC)
    }
  }, [map, selectEntity])

  // ── Station data updates ───────────────────────────────────────────────────
  useEffect(() => {
    const src = map.getSource(STN_SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return
    const visible = filterStn ? stations : []
    src.setData({
      type: 'FeatureCollection',
      features: visible.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon!, s.lat!] },
        properties: { id: s.entity_id, name: s.display_name ?? s.entity_id, online: s.status === 'online' },
      })),
    })
  }, [stations, map, filterStn])

  return null
}
