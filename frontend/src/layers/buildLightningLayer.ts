import { IconLayer } from '@deck.gl/layers'
import { getAtlasIcons } from './atlasIcons'

export interface LightningStrike {
  lat: number
  lon: number
  ts: number   // unix ms
}

const FADE_MS = 30_000   // strike fully fades over 30 seconds

// Atlas hue: --cat-lightning #FFE94D
const LIGHTNING_RGB: [number, number, number] = [255, 233, 77]

function iconForZoom(zoom: number): string {
  if (zoom >= 11) return 'lightning'
  if (zoom >= 8)  return 'ring'
  return 'dot'
}

function baseSizeForZoom(zoom: number): number {
  if (zoom >= 11) return 18
  if (zoom >= 8)  return 12
  return 6
}

export function buildLightningLayer(strikes: LightningStrike[], nowMs: number, zoom: number) {
  const visible = strikes.filter((s) => nowMs - s.ts < FADE_MS)
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
        const age = (nowMs - s.ts) / FADE_MS
        return baseSize * (1 - age * 0.55)   // shrinks to ~45% of base as it ages
      },
      getColor: (s) => {
        const age   = (nowMs - s.ts) / FADE_MS
        const alpha = Math.round(255 * Math.max(0, 1 - age))
        return [...LIGHTNING_RGB, alpha] as [number, number, number, number]
      },
      sizeUnits: 'pixels',
      billboard: false,
      updateTriggers: {
        getIcon:  zoom,
        getSize:  [nowMs, zoom],
        getColor: nowMs,
      },
    }),
  ]
}
