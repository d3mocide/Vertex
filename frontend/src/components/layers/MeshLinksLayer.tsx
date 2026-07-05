import { useEffect } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useCivicStore } from '../../store'
import type { Entity } from '../../store'
import { useEntitiesByType } from '../../hooks/useEntities'
import { DEFAULT_CENTER } from '../../config'

interface MeshLink {
  node_a:       string
  node_b:       string
  snr:          number | null
  link_quality: number | null
  last_seen:    string
}

const SOURCE_ID = 'mesh-links'
const LAYER_ID = 'mesh-links-line'

// MeshCore LoRa SNR spans roughly -20..+12 dB. (The old -70/-90 thresholds
// were RSSI-scale values, so every link always rendered green.)
function snrToColor(snr: number | null): [number, number, number] {
  if (snr === null) return [150, 150, 150]
  if (snr >= 5)   return [68, 221, 136]   // strong — green
  if (snr >= -10) return [255, 184, 0]    // medium — amber
  return [255, 80, 80]                    // weak — red
}

function snrToColorHex(snr: number | null): string {
  const [r, g, b] = snrToColor(snr)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

interface Props {
  map: MapLibreMap
}

export function MeshLinksLayer({ map }: Props) {
  // Subscribe to mesh nodes only — depending on the whole entities map made
  // this effect rebuild its GeoJSON on every aircraft/vessel update.
  const meshNodes = useEntitiesByType('mesh_node')
  const meshLinks = useCivicStore((s) => s.meshLinks)
  const meshStatus = useCivicStore((s) => s.meshStatus)

  // Initialize Layer and Source
  useEffect(() => {
    if (!map) return

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      })

      map.addLayer({
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color':    ['get', 'color'],
          'line-width':    ['get', 'width'],
          'line-opacity':  ['get', 'opacity'],
          'line-dasharray': [4, 2],
        },
      })
    }

    return () => {
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      } catch (err) {
        console.debug('[MeshLinksLayer] cleanup failed:', err)
      }
    }
  }, [map])

  // Update Data
  useEffect(() => {
    if (!map) return
    const source = map.getSource(SOURCE_ID) as any
    if (!source) return

    const now = Date.now()

    const byId: Record<string, Entity> = {}
    for (const n of meshNodes) byId[n.entity_id] = n

    // Packet-derived links may be recorded with node_a = "local" (the
    // repeater itself). Anchor those at the repeater's reported position
    // from mesh:status (GPS from /api/stats or the ?lat=&lon= source pin),
    // falling back to the configured region center.
    const resolve = (id: string): [number, number] | null => {
      if (id === 'local') {
        const lat = Number(meshStatus?.lat)
        const lon = Number(meshStatus?.lon)
        if (Number.isFinite(lat) && Number.isFinite(lon)) return [lon, lat]
        return DEFAULT_CENTER
      }
      const n = byId[id]
      return n && n.lat != null && n.lon != null ? [n.lon, n.lat] : null
    }

    const features = meshLinks.flatMap((link) => {
      const coordA = resolve(link.node_a)
      const coordB = resolve(link.node_b)
      if (!coordA || !coordB) return []

      // Missing/unparsable last_seen (NaN) counts as fresh rather than
      // dimming the link to minimum opacity.
      const ageMinutes = (now - new Date(link.last_seen).getTime()) / 60_000
      const opacity = !Number.isFinite(ageMinutes) || ageMinutes < 5 ? 0.9
        : ageMinutes < 15 ? 0.6 : ageMinutes < 30 ? 0.35 : 0.15
      const quality = link.link_quality ?? 0
      const width = 1.5 + (Math.min(Math.max(quality, 0), 100) / 100) * 2.5

      return [{
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [coordA, coordB],
        },
        properties: {
          snr:     link.snr,
          color:   snrToColorHex(link.snr),
          width,
          opacity,
        },
      }]
    })

    source.setData({
      type: 'FeatureCollection',
      features
    })
  }, [map, meshNodes, meshLinks, meshStatus])

  return null
}
