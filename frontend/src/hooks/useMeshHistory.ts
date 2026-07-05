import { useEffect } from 'react'
import { useCivicPick } from '../store'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

export function useMeshHistory() {
  const { setMeshLinks, setMeshMessages, setMeshStatus, connected } = useCivicPick('setMeshLinks', 'setMeshMessages', 'setMeshStatus', 'connected')

  useEffect(() => {
    if (!connected) return

    // Initial load for links, messages, and status
    const hydrate = async () => {
      try {
        const [linksRes, msgsRes, statusRes] = await Promise.all([
          fetch(`${API_BASE}/mesh/links`, { headers: authHeaders() }),
          fetch(`${API_BASE}/mesh/messages`, { headers: authHeaders() }),
          fetch(`${API_BASE}/mesh/status`, { headers: authHeaders() })
        ])
        
        const links = await linksRes.json()
        const msgs = await msgsRes.json()
        const status = await statusRes.json()

        if (Array.isArray(links)) setMeshLinks(links)
        if (Array.isArray(msgs)) setMeshMessages(msgs)
        if (status) setMeshStatus(status)
      } catch (err) {
        console.debug('[useMeshHistory] hydrate failed:', err)
      }
    }

    hydrate()
    
    // Messages are handled in real-time via WebSocket after hydration.
    // Topology (links) are refreshed by useMeshLinks().
  }, [connected, setMeshLinks, setMeshMessages, setMeshStatus])
}
