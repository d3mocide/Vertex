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
        if (Array.isArray(msgs)) setMeshMessages(msgs.reverse()) // Store expects oldest first if appending
      } catch (err) {
        console.debug('[useMeshHistory] hydrate failed:', err)
      }
    }

    hydrate()
    
    // Periodically refresh links (topology) every 30s
    // Messages are handled in real-time via WebSocket after hydration
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/mesh/links`, { headers: authHeaders() })
        const data = await res.json()
        if (Array.isArray(data)) setMeshLinks(data)
      } catch (err) {
        console.debug('[useMeshHistory] link poll failed:', err)
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [connected, setMeshLinks, setMeshMessages])
}
