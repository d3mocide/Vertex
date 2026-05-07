import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

const TERRAIN_SRC = 'terrain-dem'

// AWS/Nextzen Terrarium elevation tiles — free, no API key required.
// Encoding: each pixel encodes elevation as (R * 256 + G + B / 256) - 32768
const TERRAIN_TILES = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
]

export function TerrainLayer({ map }: Props) {
  const terrainEnabled    = useCivicStore((s) => s.terrainEnabled)
  const terrainExaggeration = useCivicStore((s) => s.terrainExaggeration)

  useEffect(() => {
    // Add the DEM source once on mount
    if (map && typeof map.getSource === 'function' && !map.getSource(TERRAIN_SRC)) {
      map.addSource(TERRAIN_SRC, {
        type:     'raster-dem',
        tiles:    TERRAIN_TILES,
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom:  15,
      })
    }
  }, [map])

  useEffect(() => {
    if (!map || typeof map.setTerrain !== 'function') return
    if (terrainEnabled) {
      map.setTerrain({ source: TERRAIN_SRC, exaggeration: terrainExaggeration })
    } else {
      map.setTerrain(null)
    }
  }, [map, terrainEnabled, terrainExaggeration])

  return null
}
