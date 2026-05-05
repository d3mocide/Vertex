import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

interface Props {
  map: maplibregl.Map
}

export function CustomLayersLayer({ map }: Props) {
  const setCustomLayers = useCivicStore((s) => s.setCustomLayers)
  void map

  // Fetch layers from API and sync to store
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/layers`, { headers: authHeaders() })
        if (res.ok && !cancelled) setCustomLayers(await res.json())
      } catch { /* ignore */ }
    }
    load()
    const interval = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [setCustomLayers])

  return null
}
