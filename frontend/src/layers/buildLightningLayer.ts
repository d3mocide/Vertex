import { IconLayer } from '@deck.gl/layers'
import { getAtlasIcons } from './atlasIcons'

export interface LightningStrike {
  lat: number
  lon: number
  ts: number   // unix ms
}

const FADE_MS = 30_000   // strike fully fades over 30 seconds
const FUTURE_SKEW_MS = 5_000

// Atlas hue: --cat-lightning #FFE94D
const LIGHTNING_RGB: [number, number, number] = [255, 233, 77]

function iconForZoom(zoom: number): string {
  if (zoom >= 9) return 'lightning'
  if (zoom >= 6) return 'ring'
  return 'dot'
}

function baseSizeForZoom(zoom: number): number {
  if (zoom >= 9) return 18
  if (zoom >= 6) return 18
  return 8
}

export function buildLightningLayer(strikes: LightningStrike[], nowMs: number, zoom: number) {
  const visible = strikes.filter((s) => {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !Number.isFinite(s.ts)) return false
    if (s.lat < -90 || s.lat > 90 || s.lon < -180 || s.lon > 180) return false
    const ageMs = nowMs - s.ts
    return ageMs >= -FUTURE_SKEW_MS && ageMs < FADE_MS
  })
  if (visible.length === 0) return []

  const atlas    = getAtlasIcons()
  const iconName = iconForZoom(zoom)
  const baseSize = baseSizeForZoom(zoom)

  return [
    new IconLayer<LightningStrike>({
      id:          'lightning-strikes',
      data:        visible,
      pickable:    false,
      iconAtlas:   atlas.url,
      iconMapping: atlas.mapping,
      getIcon:     () => iconName,
      getPosition: (s) => [s.lon, s.lat],
      getSize:     (s) => {
        const age = Math.max(0, Math.min(1, (nowMs - s.ts) / FADE_MS))
        return baseSize * (1 - age * 0.55)   // shrinks to ~45% of base as it ages
      },
      getColor: (s) => {
        const age = Math.max(0, Math.min(1, (nowMs - s.ts) / FADE_MS))
        const alpha = Math.round(255 * (1 - age))
        return [...LIGHTNING_RGB, alpha] as [number, number, number, number]
      },
      sizeUnits: 'pixels',
      billboard: true,
      updateTriggers: {
        getIcon:  zoom,
        getSize:  [nowMs, zoom],
        getColor: nowMs,
      },
    }),
  ]
}
