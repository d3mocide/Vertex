import { useEffect, useState } from 'react'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

export interface RegionBbox {
  min_lat: number
  max_lat: number
  min_lon: number
  max_lon: number
}

export interface Region {
  id: string
  name: string
  bbox: RegionBbox
  enabled: boolean
  show_on_map: boolean
}

export function useRegions(): Region[] {
  const [regions, setRegions] = useState<Region[]>([])
  useEffect(() => {
    fetch(`${API_BASE}/config/regions?t=${Date.now()}`, { headers: authHeaders() })
      .then(r => {
        if (!r.ok) throw new Error('Not authorized')
        return r.json()
      })
      .then((data: Region[]) => {
        if (Array.isArray(data)) setRegions(data)
      })
      .catch(() => {})
  }, [])
  return regions
}
