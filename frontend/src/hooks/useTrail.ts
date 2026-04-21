import { useEffect } from 'react'
import { API_BASE } from '../config'
import { useCivicStore } from '../store'

export function useTrail() {
  const selectedEntityId = useCivicStore((s) => s.selectedEntityId)
  const setTrail = useCivicStore((s) => s.setTrail)

  useEffect(() => {
    if (!selectedEntityId) {
      setTrail([])
      return
    }
    const controller = new AbortController()
    fetch(`${API_BASE}/entities/${encodeURIComponent(selectedEntityId)}/trail`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => setTrail(Array.isArray(data) ? data : []))
      .catch(() => {})
    return () => controller.abort()
  }, [selectedEntityId])
}
