import { IconLayer } from '@deck.gl/layers'
import type { TrafficCamera } from '../store'
import { getAtlasIcons } from './atlasIcons'

// Atlas hue: --cat-cam #FFB800 (amber gold)
const COLOR_DEFAULT:  [number, number, number, number] = [255, 184,   0, 200]
const COLOR_SELECTED: [number, number, number, number] = [255, 184,   0, 255]

function iconForZoom(zoom: number): string {
  if (zoom >= 11) return 'camera'
  if (zoom >= 8)  return 'ring'
  return 'dot'
}

function iconSize(selectedId: string | null, id: string, zoom: number): number {
  if (zoom < 8)  return 6
  if (zoom < 11) return 12
  return id === selectedId ? 28 : 22
}

export function buildCameraLayer(
  cameras: TrafficCamera[],
  selectedCamId: string | null,
  zoom: number,
) {
  const data  = cameras.filter((c) => c.lat != null && c.lon != null)
  const atlas = getAtlasIcons()

  return new IconLayer<TrafficCamera>({
    id:          'camera-points',   // id kept for tooltip + click handler compat
    data,
    pickable:    true,
    iconAtlas:   atlas.url,
    iconMapping: atlas.mapping,
    getIcon:     () => iconForZoom(zoom),
    getPosition: (c) => [c.lon!, c.lat!],
    getSize:     (c) => iconSize(selectedCamId, c.id, zoom),
    getColor:    (c) => c.id === selectedCamId ? COLOR_SELECTED : COLOR_DEFAULT,
    sizeUnits:   'pixels',
    billboard:   false,
    updateTriggers: {
      getIcon:  zoom,
      getSize:  [selectedCamId, zoom],
      getColor: selectedCamId,
    },
  })
}
