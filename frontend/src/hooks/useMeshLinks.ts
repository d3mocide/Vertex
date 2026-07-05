import { useEffect } from 'react'
import { useCivicPick } from '../store'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

export function useMeshLinks() {
  const { setMeshLinks, connected } = useCivicPick('setMeshLinks', 'connected')

  useEffect(() => {
    if (!connected) return

    const fetchLinks = () => {
      fetch(`${API_BASE}/mesh/links`, { headers: authHeaders() })
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) {
            setMeshLinks(data)
          }
        })
        .catch(err => console.debug('[useMeshLinks] fetch failed:', err))
    }

    fetchLinks()
    const interval = setInterval(fetchLinks, 30000)
    return () => clearInterval(interval)
  }, [connected, setMeshLinks])
}
