import { useEffect, useRef } from 'react'
import { WS_URL } from '../config'
import { useCivicStore } from '../store'

const RECONNECT_DELAY_MS = 3000

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const { setEntities, upsertEntity, setConnected } = useCivicStore()

  useEffect(() => {
    let cancelled = false

    const connect = () => {
      if (cancelled) return
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)

      ws.onclose = () => {
        setConnected(false)
        if (!cancelled) setTimeout(connect, RECONNECT_DELAY_MS)
      }

      ws.onerror = () => ws.close()

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string)
        if (msg.type === 'snapshot') setEntities(msg.data)
        else if (msg.type === 'entity_update') upsertEntity(msg.data)
      }
    }

    connect()
    return () => {
      cancelled = true
      wsRef.current?.close()
    }
  }, [])
}
