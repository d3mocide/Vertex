import { useEffect, useState } from 'react'
import { API_BASE } from '../config'

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
}

export function useRegions(): Region[] {
  const [regions, setRegions] = useState<Region[]>([])
  useEffect(() => {
    fetch(`${API_BASE}/config/regions`)
      .then(r => r.json())
      .then((data: Region[]) => setRegions(data))
      .catch(() => {})
  }, [])
  return regions
}
