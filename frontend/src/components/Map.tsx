import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MAP_STYLE, DEFAULT_CENTER, DEFAULT_ZOOM, PRESERVE_DRAWING_BUFFER } from '../config'
import { RadarLayer }           from './layers/RadarLayer'
import { SmokeLayer }           from './layers/SmokeLayer'
import { GOESLayer }            from './layers/GOESLayer'
import { FirePerimeterLayer }   from './layers/FirePerimeterLayer'
import { GeofenceLayer }        from './layers/GeofenceLayer'
import { ObservationRingLayer } from './layers/ObservationRingLayer'
import { CustomLayersLayer }    from './layers/CustomLayersLayer'
import { AnnotationOverlay }    from './layers/AnnotationOverlay'
import { TerrainLayer }         from './layers/TerrainLayer'
import { RadarReflectivityLayer } from './layers/RadarReflectivityLayer'
import { NWSAlertsLayer }         from './layers/NWSAlertsLayer'
import { LightningDensityLayer }  from './layers/LightningDensityLayer'
import { MapOverlay }           from './MapOverlay'
import { useWebSocket }  from '../hooks/useWebSocket'
import { useRegions }    from '../hooks/useRegions'
import { RegionLayer }      from './layers/RegionLayer'
import { MeshLinksLayer }   from './layers/MeshLinksLayer'
import { RailLayer }        from './layers/RailLayer'

function makeCircleImage(size: number, rgba: [number, number, number, number]) {
  const [r, g, b, a] = rgba
  const data = new Uint8Array(size * size * 4)
  const radius = size / 2 - 0.5
  const cx = (size - 1) / 2
  const cy = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const idx = (y * size + x) * 4
      if (dx * dx + dy * dy <= radius * radius) {
        data[idx] = r
        data[idx + 1] = g
        data[idx + 2] = b
        data[idx + 3] = a
      }
    }
  }
  return { width: size, height: size, data }
}

function makeWoodPatternImage(size: number) {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      // Low-contrast mottled green so park/wood fills remain readable without banding.
      const noise = ((x * 13 + y * 17) % 19) - 9
      const r = Math.max(0, Math.min(255, 26 + noise))
      const g = Math.max(0, Math.min(255, 52 + noise * 2))
      const b = Math.max(0, Math.min(255, 34 + noise))
      data[idx] = r
      data[idx + 1] = g
      data[idx + 2] = b
      data[idx + 3] = 42
    }
  }
  return { width: size, height: size, data }
}

export const KNOWN_STYLE_IMAGE_FALLBACKS: Record<string, () => { width: number; height: number; data: Uint8Array }> = {
  'circle-11': () => makeCircleImage(11, [173, 181, 189, 220]),
  'wood-pattern': () => makeWoodPatternImage(16),
}

const SELF_HOSTED_STYLE_IMAGES: Record<string, string> = {
  'circle-11': '/sprites/circle-11.png',
  'wood-pattern': '/sprites/wood-pattern.png',
}

function loadMapImage(map: maplibregl.Map, url: string): Promise<ImageBitmap | HTMLImageElement | ImageData> {
  return map.loadImage(url).then((result) => {
    if (result && typeof result === 'object' && 'data' in result) {
      return (result as { data: ImageBitmap | HTMLImageElement | ImageData }).data
    }
    return result as ImageBitmap | HTMLImageElement | ImageData
  })
}

export async function ensureKnownStyleImages(map: maplibregl.Map) {
  for (const [id, makeFallback] of Object.entries(KNOWN_STYLE_IMAGE_FALLBACKS)) {
    if (map.hasImage(id)) continue

    const selfHostedUrl = SELF_HOSTED_STYLE_IMAGES[id]
    if (selfHostedUrl) {
      try {
        const image = await loadMapImage(map, selfHostedUrl)
        if (!map.hasImage(id)) map.addImage(id, image)
        continue
      } catch {
        // Fallback below keeps map resilient if local sprite files are unavailable.
      }
    }

    if (!map.hasImage(id)) map.addImage(id, makeFallback())
  }
}

export function Map() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  useWebSocket()
  const regions = useRegions()

  useEffect(() => {
    if (!containerRef.current) return
    const m = new maplibregl.Map({
      container: containerRef.current,
      style:     MAP_STYLE,
      center:    DEFAULT_CENTER,
      zoom:      DEFAULT_ZOOM,
      attributionControl: false,
      antialias: true,
      preserveDrawingBuffer: PRESERVE_DRAWING_BUFFER,
    })

    // Static region-center marker so operators can quickly orient to the
    // configured area of responsibility.
    const regionMarkerEl = document.createElement('div')
    regionMarkerEl.className = 'ms text-[18px] text-green-ais drop-shadow-[0_0_6px_rgba(0,200,83,0.55)]'
    regionMarkerEl.textContent = 'my_location'
    regionMarkerEl.setAttribute('aria-hidden', 'true')

    const regionMarker = new maplibregl.Marker({
      element: regionMarkerEl,
      anchor: 'center',
    })
      .setLngLat(DEFAULT_CENTER)
      .addTo(m)

    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    const warnedMissing = new Set<string>()
    let ensureKnownImagesInFlight = false

    const ensureKnownImages = async () => {
      if (ensureKnownImagesInFlight) return
      ensureKnownImagesInFlight = true
      try {
        await ensureKnownStyleImages(m)
      } finally {
        ensureKnownImagesInFlight = false
      }
    }

    // Pre-register known missing sprite IDs as soon as style data is available
    // so style layers never hit the missing-image warning path.
    m.on('styledata', () => {
      if (m.isStyleLoaded()) void ensureKnownImages()
    })

    m.on('styleimagemissing', (e) => {
      const id = e.id
      if (m.hasImage(id)) return

      const makeFallback = KNOWN_STYLE_IMAGE_FALLBACKS[id]
      if (makeFallback) {
        m.addImage(id, makeFallback())
        return
      }

      if (!warnedMissing.has(id)) {
        warnedMissing.add(id)
        console.warn(`Map style image missing: ${id}. Using transparent fallback.`)
      }
      const data = new Uint8Array(4)
      m.addImage(id, { width: 1, height: 1, data })
    })

    m.on('error', (event) => {
      const error = (event as { error?: unknown }).error
      if (error) {
        console.error('[map] MapLibre error:', error)
      }
    })

    m.on('load', () => {
      void ensureKnownImages()
      setMap(m)
    })

    return () => {
      regionMarker.remove()
      m.remove()
    }
  }, [])

  return (
    <div
      className="w-full h-full relative"
      id="main-content"
      role="main"
      aria-label="Situational awareness map"
    >
      <div ref={containerRef} className="absolute inset-0" />
      {map && (
        <>
          <TerrainLayer          map={map} />
          <RadarLayer            map={map} />
          <RadarReflectivityLayer map={map} />
          <NWSAlertsLayer        map={map} />
          <LightningDensityLayer map={map} />
          <SmokeLayer            map={map} />
          <GOESLayer             map={map} />
          <FirePerimeterLayer    map={map} />
          <GeofenceLayer         map={map} />
          <CustomLayersLayer     map={map} />
          <ObservationRingLayer  map={map} />
          <AnnotationOverlay     map={map} />
          <RegionLayer           map={map} regions={regions} />
          <MeshLinksLayer        map={map} />
          <RailLayer             map={map} />
          <MapOverlay            map={map} />
        </>
      )}
    </div>
  )
}
