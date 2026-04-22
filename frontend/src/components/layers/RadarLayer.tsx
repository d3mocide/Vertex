import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { RADAR_REFRESH_MS } from '../../config'

interface Props { map: maplibregl.Map }

const SRC   = 'nexrad-radar'
const LAYER = 'nexrad-radar-layer'

// IEM NEXRAD CONUS composite — timestamp 0 always resolves to the latest frame.
// The ?_= bust param prevents MapLibre's internal tile cache from serving stale
// tiles after a refresh cycle.
function tileUrl(bust: number) {
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::CONUS-N0Q-0/{z}/{x}/{y}.png?_=${bust}`
}

function addToMap(map: maplibregl.Map, opacity: number, bust: number) {
  map.addSource(SRC, {
    type: 'raster',
    tiles: [tileUrl(bust)],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 8,
    attribution: '<a href="https://mesonet.agron.iastate.edu/" target="_blank">IEM NEXRAD</a>',
  })
  map.addLayer({
    id: LAYER,
    type: 'raster',
    source: SRC,
    paint: {
      'raster-opacity': opacity,
      'raster-opacity-transition': { duration: 400, delay: 0 },
    },
  })
}

function removeFromMap(map: maplibregl.Map) {
  if (map.getLayer(LAYER)) map.removeLayer(LAYER)
  if (map.getSource(SRC))  map.removeSource(SRC)
}

export function RadarLayer({ map }: Props) {
  const radarVisible = useCivicStore((s) => s.radarVisible)
  const radarOpacity = useCivicStore((s) => s.radarOpacity)
  // Keep a stable ref to opacity so the refresh interval always uses the
  // current value without being a dependency that restarts the timer.
  const opacityRef = useRef(radarOpacity)
  opacityRef.current = radarOpacity

  // Mount/unmount the layer + refresh every RADAR_REFRESH_MS
  useEffect(() => {
    if (!radarVisible) return

    const bust = Date.now()
    addToMap(map, opacityRef.current, bust)

    const timer = setInterval(() => {
      removeFromMap(map)
      addToMap(map, opacityRef.current, Date.now())
    }, RADAR_REFRESH_MS)

    return () => {
      clearInterval(timer)
      removeFromMap(map)
    }
  }, [map, radarVisible])

  // Opacity-only updates — no tile reload needed
  useEffect(() => {
    if (map.getLayer(LAYER)) {
      map.setPaintProperty(LAYER, 'raster-opacity', radarOpacity)
    }
  }, [map, radarOpacity])

  return null
}
