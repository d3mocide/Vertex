import { useEffect } from 'react'
import { useCivicStore } from '../store'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

export function useMeshHistory() {
  const { setMeshLinks, setMeshMessages, connected } = useCivicStore()

  useEffect(() => {
    if (!connected) return

    // Initial load for both links and messages
    const hydrate = async () => {
      try {
        const [linksRes, msgsRes] = await Promise.all([
          fetch(`${API_BASE}/mesh/links`, { headers: authHeaders() }),
          fetch(`${API_BASE}/mesh/messages`, { headers: authHeaders() })
        ])
        
        const links = await linksRes.json()
        const msgs = await msgsRes.json()

        if (Array.isArray(links)) setMeshLinks(links)
        if (Array.isArray(msgs)) setMeshMessages(msgs)
      } catch (err) {
        console.debug('[useMeshHistory] hydrate failed:', err)
      }
    }

    hydrate()
    
    // Messages are handled in real-time via WebSocket after hydration.
    // Topology (links) are refreshed by useMeshLinks().
  }, [connected, setMeshLinks, setMeshMessages])
}
