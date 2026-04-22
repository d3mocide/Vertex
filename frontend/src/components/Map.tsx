import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MAP_STYLE, DEFAULT_CENTER, DEFAULT_ZOOM } from '../config'
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

    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'imperial' }), 'bottom-left')
    m.on('load', () => setMap(m))

    return () => m.remove()
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
          <MeshLayer     map={map} />
          <MapOverlay    map={map} />
        </>
      )}
    </div>
  )
}
