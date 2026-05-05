import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useEntitiesByType } from '../../hooks/useEntities'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

const SRC   = 'stream-gauges'
const LAYER = 'stream-gauge-dots'
const RING  = 'stream-gauge-ring'
const LABEL = 'stream-gauge-label'

// Flow stage → map color
const STAGE_COLOR: Record<string, string> = {
  normal:          '#4fc3f7',   // light blue
  elevated:        '#fff176',   // yellow
  'minor flood':   '#ffb74d',   // orange
  'moderate flood':'#ef5350',   // red
  'major flood':   '#b71c1c',   // dark red
  unknown:         '#90a4ae',   // grey
}

export function StreamGaugeLayer({ map }: Props) {
  const gauges       = useEntitiesByType('stream_gauge')
  const gaugesVisible = useCivicStore((s) => s.gaugesVisible)
  const selectEntity  = useCivicStore((s) => s.selectEntity)

  useEffect(() => {
    const visible = gaugesVisible ? gauges : []

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: visible.map((g) => {
        const ident  = (g.identity ?? {}) as Record<string, unknown>
        const flow   = typeof ident.flow_cfs  === 'number' ? ident.flow_cfs  : null
        const height = typeof ident.height_ft === 'number' ? ident.height_ft : null
        const stage  = typeof ident.stage     === 'string' ? ident.stage     : 'unknown'
        const color  = STAGE_COLOR[stage] ?? STAGE_COLOR.unknown

        let label = g.display_name ?? g.entity_id
        if (flow !== null) label += `\n${Math.round(flow)} cfs`
        else if (height !== null) label += `\n${height.toFixed(1)} ft`

        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [g.lon!, g.lat!] },
          properties: {
            id:     g.entity_id,
            name:   g.display_name ?? g.entity_id,
            stage,
            color,
            label,
            flow:   flow ?? '',
            height: height ?? '',
          },
        }
      }),
    }

    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: geojson })

      map.addLayer({
        id:     RING,
        type:   'circle',
        source: SRC,
        paint: {
          'circle-radius':  10,
          'circle-color':   ['get', 'color'],
          'circle-opacity': 0.25,
        },
      })

      map.addLayer({
        id:     LAYER,
        type:   'circle',
        source: SRC,
        paint: {
          'circle-radius':        5,
          'circle-color':         ['get', 'color'],
          'circle-stroke-width':  1.2,
          'circle-stroke-color':  '#fff',
        },
      })

      map.addLayer({
        id:     LABEL,
        type:   'symbol',
        source: SRC,
        layout: {
          'text-field':      ['get', 'label'],
          'text-font':       ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size':       9,
          'text-offset':     [0, 1.6],
          'text-anchor':     'top',
          'text-max-width':  8,
        },
        paint: {
          'text-color':      '#e0f7fa',
          'text-halo-color': '#050505',
          'text-halo-width': 1,
        },
      })

      map.on('click', LAYER, (e) => {
        const f = e.features?.[0]
        if (f?.properties?.id) selectEntity(f.properties.id as string)
      })
      map.on('mouseenter', LAYER, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', LAYER, () => { map.getCanvas().style.cursor = '' })
    } else {
      (map.getSource(SRC) as maplibregl.GeoJSONSource).setData(geojson)
    }
  }, [gauges, map, gaugesVisible, selectEntity])

  return null
}
