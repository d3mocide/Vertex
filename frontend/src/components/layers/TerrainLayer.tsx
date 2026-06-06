import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

const TERRAIN_SRC       = 'terrain-dem'
const HILLSHADE_LAYER   = 'terrain-hillshade'
const BUILDINGS_LAYER   = '3d-buildings'

// Locate the vector source that carries OpenMapTiles building footprints so we
// can extrude them. Returns null for basemaps without buildings (e.g. some
// offline tile sets) — callers skip 3-D buildings silently in that case.
function findBuildingSource(map: maplibregl.Map): string | null {
  for (const layer of map.getStyle().layers ?? []) {
    const l = layer as { source?: string; 'source-layer'?: string }
    if (l['source-layer'] === 'building' && l.source) return l.source
  }
  return null
}

// AWS/Nextzen Terrarium elevation tiles — free, no API key required.
// Encoding: each pixel encodes elevation as (R * 256 + G + B / 256) - 32768
const TERRAIN_TILES = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
]

export function TerrainLayer({ map }: Props) {
  const terrainEnabled      = useCivicStore((s) => s.terrainEnabled)
  const terrainExaggeration = useCivicStore((s) => s.terrainExaggeration)
  const buildingsEnabled    = useCivicStore((s) => s.buildingsEnabled)

  useEffect(() => {
    if (!map) return

    // ── Atmospheric sky + fog — adds horizon depth to the 3-D scene ──────────
    function applySky(enabled: boolean) {
      if (typeof map.setSky !== 'function') return
      if (enabled) {
        map.setSky({
          'sky-color':         '#0A0A0A',
          'horizon-color':     '#1a2230',
          'fog-color':         '#0d1117',
          'sky-horizon-blend': 0.5,
          'horizon-fog-blend': 0.5,
          'fog-ground-blend':  0.6,
          // Fade the atmosphere out as the camera drops toward street level.
          'atmosphere-blend':  ['interpolate', ['linear'], ['zoom'], 4, 0.8, 13, 0],
        })
      } else {
        // Passing undefined clears the sky at runtime; the typings mark the
        // argument as required, so cast to a signature that accepts no spec.
        ;(map.setSky as (spec?: maplibregl.SkySpecification) => void)(undefined)
      }
    }

    // ── 3-D building extrusions ──────────────────────────────────────────────
    function applyBuildings(enabled: boolean) {
      if (enabled && !map.getLayer(BUILDINGS_LAYER)) {
        const source = findBuildingSource(map)
        if (!source) return  // basemap has no building footprints — skip silently
        const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id
        map.addLayer(
          {
            id:             BUILDINGS_LAYER,
            source,
            'source-layer': 'building',
            type:           'fill-extrusion',
            minzoom:        13,
            paint: {
              'fill-extrusion-color':   '#15171c',
              'fill-extrusion-height':  ['coalesce', ['get', 'render_height'], ['get', 'height'], 8],
              'fill-extrusion-base':    ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
              'fill-extrusion-opacity': 0.85,
            },
          },
          firstSymbol,
        )
      } else if (!enabled && map.getLayer(BUILDINGS_LAYER)) {
        map.removeLayer(BUILDINGS_LAYER)
      }
    }

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

        // ── 2c. Atmosphere + optional 3-D buildings ──────────────────────────
        applySky(true)
        applyBuildings(buildingsEnabled)

        // ── 2d. Auto-pitch so the 3-D effect is immediately visible ─────────
        // Only pitch if the map is currently flat — don't override manual tilts.
        if (map.getPitch() < 5) {
          map.easeTo({ pitch: 45, duration: 800 })
        }
      } else {
        // ── 3. Tear down hillshade, sky, buildings and restore flat terrain ──
        if (map.getLayer(HILLSHADE_LAYER)) {
          map.removeLayer(HILLSHADE_LAYER)
        }
        applyBuildings(false)
        applySky(false)
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
  }, [map, terrainEnabled, terrainExaggeration, buildingsEnabled])

  return null
}
