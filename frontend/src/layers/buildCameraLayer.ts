import { ScatterplotLayer } from '@deck.gl/layers'
import type { TrafficCamera } from '../store'

// Amber gold palette matching the design system
const COLOR_DEFAULT:  [number, number, number, number] = [255, 186,   0, 200]
const COLOR_SELECTED: [number, number, number, number] = [255, 186,   0, 255]
const COLOR_RING:     [number, number, number, number] = [255, 186,   0, 255]

export function buildCameraLayer(
  cameras: TrafficCamera[],
  selectedCamId: string | null,
) {
  const data = cameras.filter((c) => c.lat != null && c.lon != null)

  return new ScatterplotLayer<TrafficCamera>({
    id:            'camera-points',
    data,
    getPosition:   (c) => [c.lon!, c.lat!],
    getRadius:     (c) => c.id === selectedCamId ? 11 : 7,
    getFillColor:  (c) => c.id === selectedCamId ? COLOR_SELECTED : COLOR_DEFAULT,
    getLineColor:  COLOR_RING,
    stroked:       true,
    filled:        true,
    getLineWidth:  2,
    lineWidthUnits: 'pixels',
    radiusUnits:   'pixels',
    pickable:      true,
    updateTriggers: {
      getRadius:   selectedCamId,
      getFillColor: selectedCamId,
    },
  })
}
