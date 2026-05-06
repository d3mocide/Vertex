import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MAP_STYLE, DEFAULT_CENTER, DEFAULT_ZOOM, PRESERVE_DRAWING_BUFFER } from '../config'
import { RadarLayer }           from './layers/RadarLayer'
import { SmokeLayer }           from './layers/SmokeLayer'
import { GeofenceLayer }        from './layers/GeofenceLayer'
import { ObservationRingLayer } from './layers/ObservationRingLayer'
import { CustomLayersLayer }    from './layers/CustomLayersLayer'
import { AnnotationOverlay }    from './layers/AnnotationOverlay'
import { TerrainLayer }         from './layers/TerrainLayer'
import { MapOverlay }           from './MapOverlay'
import { useWebSocket }  from '../hooks/useWebSocket'

export function Map() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  useWebSocket()

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
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'imperial' }), 'bottom-left')
    m.on('styleimagemissing', (e) => {
      const id = e.id
      console.warn(`Map style image missing: ${id}. Providing fallback.`)
      
      // Provide a tiny 1x1 transparent pixel as a fallback to stop MapLibre from complaining
      const data = new Uint8Array(4)
      m.addImage(id, { width: 1, height: 1, data })
    })

    m.on('error', (event) => {
      const error = (event as { error?: unknown }).error
      if (error) {
        console.error('[map] MapLibre error:', error)
      }
    })

    m.on('load', () => setMap(m))

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
          <SmokeLayer            map={map} />
          <GeofenceLayer         map={map} />
          <CustomLayersLayer     map={map} />
          <ObservationRingLayer  map={map} />
          <AnnotationOverlay     map={map} />
          <MapOverlay            map={map} />
        </>
      )}
    </div>
  )
}
