import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MAP_STYLE, DEFAULT_CENTER, DEFAULT_ZOOM } from '../config'
import { RadarLayer }    from './layers/RadarLayer'
import { MeshLayer }     from './layers/MeshLayer'
import { MapOverlay }    from './MapOverlay'
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
      // Performance: request hardware acceleration
      antialias: true,
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
          <RadarLayer    map={map} />
          <MeshLayer     map={map} />
          <MapOverlay    map={map} />
        </>
      )}
    </div>
  )
}
