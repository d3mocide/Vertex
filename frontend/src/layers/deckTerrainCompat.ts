import type { Map as MapLibreMap } from 'maplibre-gl'

/**
 * deck.gl's MapboxOverlay centres its camera on the terrain surface by reading `map.transform.elevation`, but MapLibre 6
 * no longer exposes `Map.transform`, so any map with 3D terrain enabled throws "Cannot read properties of undefined
 * (reading 'elevation')" when the overlay is added and the whole app unmounts. deck.gl 9.4.0 is the latest release and
 * still does this. MapLibre's public `getCameraTargetElevation()` is the same number, so expose just that on a
 * `transform` stand-in. A map that still has a real `transform` (an older MapLibre) is left untouched.
 */
export function installDeckTerrainCompat(map: MapLibreMap): void {
  if ((map as unknown as { transform?: unknown }).transform) return
  Object.defineProperty(map, 'transform', {
    configurable: true,
    get: () => ({
      get elevation(): number {
        try {
          const e = map.getCameraTargetElevation()
          return typeof e === 'number' && Number.isFinite(e) ? e : 0
        } catch { return 0 }
      },
    }),
  })
}
