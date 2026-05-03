import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useEntitiesByType } from '../../hooks/useEntities'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

// Satellite sources/layers
const SAT_SRC        = 'tinygs-satellites'
const SAT_GLOW       = 'tinygs-satellite-glow'
const SAT_DOT        = 'tinygs-satellite-dot'
const SAT_LABEL      = 'tinygs-satellite-label'

// Station sources/layers
const STN_SRC        = 'tinygs-stations'
const STN_RING       = 'tinygs-station-ring'
const STN_DOT        = 'tinygs-station-dot'

const SAT_COLOR  = '#9E6CFF'   // violet-space
const SAT_LABEL_COLOR = '#C4A8FF'
const STN_COLOR  = '#FF8F00'   // amber-p25 — local ground infrastructure

export function TinyGSLayer({ map }: Props) {
  const satellites    = useEntitiesByType('satellite')
  const stations      = useEntitiesByType('tinygs_station')
  const filterSat     = useCivicStore((s) => s.entityFilter.satellite)
  const filterStn     = useCivicStore((s) => s.entityFilter.tinygs_station)
  const selectEntity  = useCivicStore((s) => s.selectEntity)

  // ── Satellite layer ────────────────────────────────────────────────────────
  useEffect(() => {
    const visible = filterSat ? satellites : []

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: visible.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon!, s.lat!] },
        properties: {
          id:   s.entity_id,
          name: s.display_name ?? s.entity_id,
          alt:  s.altitude != null ? Math.round(s.altitude / 1000) : null,  // km
        },
      })),
    }

    if (!map.getSource(SAT_SRC)) {
      map.addSource(SAT_SRC, { type: 'geojson', data: geojson })

      // Wide glow — signals orbital position is approximate
      map.addLayer({
        id: SAT_GLOW,
        type: 'circle',
        source: SAT_SRC,
        paint: {
          'circle-radius': 16,
          'circle-color':   SAT_COLOR,
          'circle-opacity': 0.15,
        },
      })

      // Core dot
      map.addLayer({
        id: SAT_DOT,
        type: 'circle',
        source: SAT_SRC,
        paint: {
          'circle-radius': 5,
          'circle-color':  SAT_COLOR,
          'circle-stroke-width':  1.5,
          'circle-stroke-color':  '#fff',
        },
      })

      // Name + altitude label
      map.addLayer({
        id: SAT_LABEL,
        type: 'symbol',
        source: SAT_SRC,
        layout: {
          'text-field': [
            'case',
            ['!=', ['get', 'alt'], null],
            ['concat', ['get', 'name'], '\n', ['to-string', ['get', 'alt']], ' km'],
            ['get', 'name'],
          ],
          'text-font':   ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size':   10,
          'text-offset': [0, 1.6],
          'text-anchor': 'top',
          'text-max-width': 10,
        },
        paint: {
          'text-color':       SAT_LABEL_COLOR,
          'text-halo-color':  '#050505',
          'text-halo-width':  1.2,
        },
      })

      map.on('click', SAT_DOT, (e) => {
        const f = e.features?.[0]
        if (f?.properties?.id) selectEntity(f.properties.id as string)
      })
      map.on('mouseenter', SAT_DOT, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', SAT_DOT, () => { map.getCanvas().style.cursor = '' })
    } else {
      (map.getSource(SAT_SRC) as maplibregl.GeoJSONSource).setData(geojson)
    }
  }, [satellites, map, filterSat])

  // ── Ground station layer ───────────────────────────────────────────────────
  useEffect(() => {
    const visible = filterStn ? stations : []

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: visible.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon!, s.lat!] },
        properties: {
          id:     s.entity_id,
          name:   s.display_name ?? s.entity_id,
          online: s.status === 'online',
        },
      })),
    }

    if (!map.getSource(STN_SRC)) {
      map.addSource(STN_SRC, { type: 'geojson', data: geojson })

      // Outer ring — dims when offline
      map.addLayer({
        id: STN_RING,
        type: 'circle',
        source: STN_SRC,
        paint: {
          'circle-radius': 9,
          'circle-color':   ['case', ['get', 'online'], STN_COLOR, '#555'],
          'circle-opacity': 0.25,
        },
      })

      // Inner dot
      map.addLayer({
        id: STN_DOT,
        type: 'circle',
        source: STN_SRC,
        paint: {
          'circle-radius': 5,
          'circle-color':  ['case', ['get', 'online'], STN_COLOR, '#888'],
          'circle-stroke-width':  1,
          'circle-stroke-color':  '#fff',
        },
      })

      map.on('click', STN_DOT, (e) => {
        const f = e.features?.[0]
        if (f?.properties?.id) selectEntity(f.properties.id as string)
      })
      map.on('mouseenter', STN_DOT, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', STN_DOT, () => { map.getCanvas().style.cursor = '' })
    } else {
      (map.getSource(STN_SRC) as maplibregl.GeoJSONSource).setData(geojson)
    }
  }, [stations, map, filterStn])

  return null
}
