import { ScatterplotLayer } from '@deck.gl/layers'

export interface LightningStrike {
  lat: number
  lon: number
  ts: number  // unix ms
}

const FADE_MS = 30_000   // strike fully fades over 30 seconds

export function buildLightningLayer(strikes: LightningStrike[], nowMs: number) {
  const visible = strikes.filter((s) => nowMs - s.ts < FADE_MS)
  if (visible.length === 0) return []

  return [
    new ScatterplotLayer<LightningStrike>({
      id:          'lightning-strikes',
      data:        visible,
      pickable:    false,
      stroked:     false,
      filled:      true,
      radiusUnits: 'pixels',
      getPosition: (s) => [s.lon, s.lat],
      getRadius:   (s) => {
        const age = (nowMs - s.ts) / FADE_MS
        return 2 + (1 - age) * 6   // shrinks from 8px → 2px as it ages
      },
      getFillColor: (s) => {
        const age = (nowMs - s.ts) / FADE_MS
        const alpha = Math.round(255 * Math.max(0, 1 - age))
        // White core → yellow → fades out
        const g = Math.round(200 + 55 * age)
        return [255, g, 0, alpha]
      },
      updateTriggers: {
        getRadius:    nowMs,
        getFillColor: nowMs,
      },
    }),
  ]
}
