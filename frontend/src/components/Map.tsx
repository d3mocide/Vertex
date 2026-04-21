import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MAP_STYLE, DEFAULT_CENTER, DEFAULT_ZOOM } from '../config'
import { AircraftLayer } from './layers/AircraftLayer'
import { VesselLayer }   from './layers/VesselLayer'
import { MeshLayer }     from './layers/MeshLayer'
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
      // Performance: request hardware acceleration
      antialias: true,
    })

    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
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
          <AircraftLayer map={map} />
          <VesselLayer   map={map} />
          <MeshLayer     map={map} />
        </>
      )}
    </div>
  )
}
