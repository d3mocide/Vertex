import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

const TERRAIN_SRC       = 'terrain-dem'
const HILLSHADE_LAYER   = 'terrain-hillshade'

// AWS/Nextzen Terrarium elevation tiles — free, no API key required.
// Encoding: each pixel encodes elevation as (R * 256 + G + B / 256) - 32768
const TERRAIN_TILES = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
]

export function TerrainLayer({ map }: Props) {
  const terrainEnabled      = useCivicStore((s) => s.terrainEnabled)
  const terrainExaggeration = useCivicStore((s) => s.terrainExaggeration)

  useEffect(() => {
    if (!map) return

    function applyTerrain() {
      // ── 1. Ensure the DEM raster source exists ──────────────────────────────
      if (!map.getSource(TERRAIN_SRC)) {
        map.addSource(TERRAIN_SRC, {
          type:     'raster-dem',
          tiles:    TERRAIN_TILES,
          tileSize: 256,
          encoding: 'terrarium',
          maxzoom:  15,
        })
      }

      if (terrainEnabled) {
        // ── 2a. Add hillshade layer for visible relief at any pitch ───────────
        // Insert before the first symbol layer so it shades terrain fills but
        // sits under road labels.
        if (!map.getLayer(HILLSHADE_LAYER)) {
          const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id
          map.addLayer(
            {
              id:     HILLSHADE_LAYER,
              type:   'hillshade',
              source: TERRAIN_SRC,
              paint: {
                'hillshade-illumination-direction': 335,
                'hillshade-exaggeration':           0.4,
                'hillshade-shadow-color':           '#0d1117',
                'hillshade-highlight-color':        '#5b7fa6',
                'hillshade-accent-color':           '#0d1117',
              },
            },
            firstSymbol,
          )
        }

        // ── 2b. Apply 3-D terrain exaggeration ─────────────────────────────
        if (typeof map.setTerrain === 'function') {
          map.setTerrain({ source: TERRAIN_SRC, exaggeration: terrainExaggeration })
        }

        // ── 2c. Auto-pitch so the 3-D effect is immediately visible ─────────
        // Only pitch if the map is currently flat — don't override manual tilts.
        if (map.getPitch() < 5) {
          map.easeTo({ pitch: 45, duration: 800 })
        }
      } else {
        // ── 3. Tear down hillshade and restore flat terrain ──────────────────
        if (map.getLayer(HILLSHADE_LAYER)) {
          map.removeLayer(HILLSHADE_LAYER)
        }
        if (typeof map.setTerrain === 'function') {
          map.setTerrain(null)
        }
        // Reset pitch to top-down if the user hasn't manually tilted away from 45°
        if (map.getPitch() >= 40) {
          map.easeTo({ pitch: 0, duration: 600 })
        }
      }
    }

    // MapLibre requires the style to be fully loaded before addSource/setTerrain.
    if (map.loaded()) {
      applyTerrain()
    } else {
      map.once('load', applyTerrain)
      return () => { map.off('load', applyTerrain) }
    }
  }, [map, terrainEnabled, terrainExaggeration])

  return null
}
