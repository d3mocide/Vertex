import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useEntitiesByType } from '../../hooks/useEntities'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

export function AircraftLayer({ map }: Props) {
  const aircraft     = useEntitiesByType('aircraft')
  const selectEntity = useCivicStore((s) => s.selectEntity)
  const markersRef   = useRef<Record<string, maplibregl.Marker>>({})

  useEffect(() => {
    const currentIds = new Set(aircraft.map(ac => ac.entity_id))

    // Remove stale markers
    Object.keys(markersRef.current).forEach(id => {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove()
        delete markersRef.current[id]
      }
    })

    // Update/Add markers
    aircraft.forEach(ac => {
      if (!ac.lon || !ac.lat) return

      if (markersRef.current[ac.entity_id]) {
        markersRef.current[ac.entity_id].setLngLat([ac.lon, ac.lat])
      } else {
        // Create custom DOM element for the marker
        const el = document.createElement('div')
        el.className = 'aircraft-marker group cursor-pointer'
        el.innerHTML = `
          <div class="aircraft-marker-pulse"></div>
          <div class="aircraft-marker-ring"></div>
          <div class="aircraft-marker-dot"></div>
          
          <!-- Tactical label from mockup -->
          <div class="absolute left-6 top-1/2 -translate-y-1/2 flex items-center gap-1.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-onyx-black/80 border border-amber-gold p-1 text-[9px] font-bold font-mono text-amber-gold">
            <span class="ms text-[12px] leading-none">flight_takeoff</span>
            <span>${ac.display_name ?? ac.entity_id} / ${Math.round(ac.altitude ?? 0).toLocaleString()}FT</span>
          </div>
        `
        el.onclick = () => selectEntity(ac.entity_id)



        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([ac.lon, ac.lat])
          .addTo(map)
        
        markersRef.current[ac.entity_id] = marker
      }
    })
  }, [aircraft, map, selectEntity])

  // Cleanup all markers on unmount
  useEffect(() => {
    return () => {
      Object.values(markersRef.current).forEach(m => m.remove())
      markersRef.current = {}
    }
  }, [])

  return null
}

