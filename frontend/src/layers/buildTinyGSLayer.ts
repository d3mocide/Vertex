import { ScatterplotLayer } from '@deck.gl/layers'
import type { Entity } from '../store'

export interface TinyGSSatellitePoint {
  entity_id: string
  name: string
  lon: number
  lat: number
  alt_km: number | null
}

export interface TinyGSStationPoint {
  entity_id: string
  name: string
  lon: number
  lat: number
  online: boolean
}

function toSatPoint(e: Entity): TinyGSSatellitePoint | null {
  if (e.entity_type !== 'satellite' || e.lat == null || e.lon == null) return null
  return {
    entity_id: e.entity_id,
    name: e.display_name ?? e.entity_id,
    lon: e.lon,
    lat: e.lat,
    alt_km: typeof e.altitude === 'number' ? Math.round(e.altitude / 1000) : null,
  }
}

function toStationPoint(e: Entity): TinyGSStationPoint | null {
  if (e.entity_type !== 'tinygs_station' || e.lat == null || e.lon == null) return null
  return {
    entity_id: e.entity_id,
    name: e.display_name ?? e.entity_id,
    lon: e.lon,
    lat: e.lat,
    online: e.status === 'online',
  }
}

export function buildTinyGSLayers(
  entities: Entity[],
  satellitesVisible: boolean,
  stationsVisible: boolean,
) {
  const satPoints = satellitesVisible
    ? entities.map(toSatPoint).filter((p): p is TinyGSSatellitePoint => p !== null)
    : []
  const stnPoints = stationsVisible
    ? entities.map(toStationPoint).filter((p): p is TinyGSStationPoint => p !== null)
    : []

  const layers = []

  if (satPoints.length > 0) {
    layers.push(
      new ScatterplotLayer<TinyGSSatellitePoint>({
        id: 'tinygs-satellite-glow',
        data: satPoints,
        pickable: false,
        filled: true,
        stroked: false,
        radiusUnits: 'pixels',
        getPosition: (p) => [p.lon, p.lat],
        getRadius: 16,
        getFillColor: [158, 108, 255, 55],
      }),
      new ScatterplotLayer<TinyGSSatellitePoint>({
        id: 'tinygs-satellite-dot',
        data: satPoints,
        pickable: true,
        filled: true,
        stroked: true,
        radiusUnits: 'pixels',
        getPosition: (p) => [p.lon, p.lat],
        getRadius: 5,
        getFillColor: [158, 108, 255, 240],
        getLineColor: [255, 255, 255, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
      }),
    )
  }

  if (stnPoints.length > 0) {
    layers.push(
      new ScatterplotLayer<TinyGSStationPoint>({
        id: 'tinygs-station-ring',
        data: stnPoints,
        pickable: false,
        filled: true,
        stroked: false,
        radiusUnits: 'pixels',
        getPosition: (p) => [p.lon, p.lat],
        getRadius: 9,
        getFillColor: (p) => (p.online ? [255, 143, 0, 64] : [85, 85, 85, 64]),
      }),
      new ScatterplotLayer<TinyGSStationPoint>({
        id: 'tinygs-station-dot',
        data: stnPoints,
        pickable: true,
        filled: true,
        stroked: true,
        radiusUnits: 'pixels',
        getPosition: (p) => [p.lon, p.lat],
        getRadius: 5,
        getFillColor: (p) => (p.online ? [255, 143, 0, 230] : [136, 136, 136, 230]),
        getLineColor: [255, 255, 255, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
      }),
    )
  }

  return layers
}
