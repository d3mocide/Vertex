import { useEffect } from 'react'
import * as maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { MAP_PALETTE } from '../../layers/mapPalette'
import { configureTerrainElevation } from '../../layers/terrainElevation'

interface Props { map: maplibregl.Map }

const TERRAIN_SRC       = 'terrain-dem'
// MapLibre warns when one DEM source drives both terrain and hillshade, so the shading reads its own (same tiles).
const HILLSHADE_SRC     = 'terrain-hillshade-dem'
const HILLSHADE_LAYER   = 'terrain-hillshade'

// Terrarium elevation tiles, fetched and cached by the backend (TERRAIN_TILE_URL picks the upstream) so the browser
// never contacts a third party and each tile is downloaded once. Each pixel encodes (R * 256 + G + B / 256) - 32768 m.
const TERRAIN_TILES = [`${API_BASE}/terrain/dem/{z}/{x}/{y}.png`]

export function TerrainLayer({ map }: Props) {
  const terrainEnabled      = useCivicStore((s) => s.terrainEnabled)
  const terrainExaggeration = useCivicStore((s) => s.terrainExaggeration)

  useEffect(() => {
    if (!map) return

    function applyTerrain() {
      try {
        applyTerrainUnsafe()
      } catch (err) {
        // A terrain failure must not leave the user with a saved preference that fails on every load.
        console.error('[terrain] could not apply 3D terrain, turning it off:', err)
        configureTerrainElevation(map, false, 1)
        useCivicStore.getState().setTerrainEnabled(false)
      }
    }

    function applyTerrainUnsafe() {
      // ── 1. Ensure the DEM raster source exists ──────────────────────────────
      for (const id of [TERRAIN_SRC, HILLSHADE_SRC]) {
        if (!map.getSource(id)) {
          map.addSource(id, {
            type:     'raster-dem',
            tiles:    TERRAIN_TILES,
            tileSize: 256,
            encoding: 'terrarium',
            maxzoom:  15,
          })
        }
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
              source: HILLSHADE_SRC,
              paint: {
                'hillshade-illumination-direction': 335,
                'hillshade-exaggeration':           0.4,
                'hillshade-shadow-color':           MAP_PALETTE.onyxBlack,
                'hillshade-highlight-color':        MAP_PALETTE.outlineVariant,
                'hillshade-accent-color':           MAP_PALETTE.onyxDeep,
              },
            },
            firstSymbol,
          )
        }

        // Dark sky and haze so a steep tilt does not show MapLibre's default daytime blue.
        try {
          map.setSky({
            'sky-color':        MAP_PALETTE.onyxBlack,
            'horizon-color':    MAP_PALETTE.surfaceHighest,
            'fog-color':        MAP_PALETTE.onyxDeep,
            'sky-horizon-blend': 0.6,
            'horizon-fog-blend': 0.5,
            'fog-ground-blend':  0.8,
          })
        } catch { /* sky is cosmetic: terrain still works without it */ }

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
      // Overlays read ground heights from the live terrain; tell them it changed (or went away).
      configureTerrainElevation(map, terrainEnabled, terrainExaggeration)
    }

    // MapLibre requires the style to be fully loaded before addSource/setTerrain.
    if (map.loaded()) {
      applyTerrain()
    } else {
      map.once('load', applyTerrain)
      return () => { map.off('load', applyTerrain) }
    }
  }, [map, terrainEnabled, terrainExaggeration])

  useEffect(() => () => configureTerrainElevation(null, false, 1), [])

  return null
}
