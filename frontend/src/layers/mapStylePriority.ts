import type { Map } from 'maplibre-gl'

// Weather sits below road geometry/labels; operational geometry sits above
// the entire basemap. All native layers still remain below the Deck canvas.
const WEATHER_ORDER = [
  'terrain-hillshade', 'goes-overlay-layer', 'smoke-overlay-layer',
  'fire-danger-fill', 'fire-danger-line', 'noaa-lightning-layer',
  'nexrad-radar-wide-layer', 'nexrad-radar-local-layer', 'nws-alerts-layer',
]
const OPERATIONAL_ORDER = [
  'region-bounds-fill', 'region-bounds-line',
  'power-outages-fill', 'power-outages-line',
  'fire-perimeters-fill', 'fire-perimeters-line',
  'rail-tracks-line', 'rail-gtfs-line', 'mesh-links-line',
  'draw-fill', 'draw-line', 'draw-points',
  'annotation-draw-fill', 'annotation-draw-line', 'annotation-draw-points',
]
const NATIVE_IDS = new Set([...WEATHER_ORDER, ...OPERATIONAL_ORDER])

export function installMapStylePriority(map: Map): () => void {
  let applying = false
  const apply = () => {
    if (applying) return
    const layers = map.getStyle()?.layers
    if (!layers) return
    const ids = new Set(layers.map(layer => layer.id))
    const weather = WEATHER_ORDER.filter(id => ids.has(id))
    const operational = OPERATIONAL_ORDER.filter(id => ids.has(id))
    const basemap = layers.filter(layer => !NATIVE_IDS.has(layer.id))
    // Some styles draw road geometry after their first symbol layer. Keep
    // both road lines and symbols above weather, preserving their own order.
    const anchorIndex = basemap.findIndex(layer => layer.type === 'symbol' ||
      (layer.type === 'line' && /road|transport|highway|street/i.test(layer.id)))
    const split = anchorIndex < 0 ? basemap.length : anchorIndex
    const desired = [
      ...basemap.slice(0, split).map(layer => layer.id), ...weather,
      ...basemap.slice(split).map(layer => layer.id), ...operational,
    ]
    if (layers.every((layer, i) => layer.id === desired[i])) return
    applying = true
    try {
      const anchor = basemap[split]?.id
      for (const id of weather) map.moveLayer(id, anchor)
      for (const id of operational) map.moveLayer(id)
    } finally { applying = false }
  }
  map.on('styledata', apply)
  apply()
  return () => { map.off('styledata', apply) }
}
