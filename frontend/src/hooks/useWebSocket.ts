import { useEffect, useRef } from 'react'
import { WS_URL } from '../config'
import { useCivicStore } from '../store'

const RECONNECT_DELAY_MS = 3000

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const { setEntities, upsertEntity, purgeStaleEntities, setConnected, setRadio, appendSystemEvent } = useCivicStore()

  useEffect(() => {
    let cancelled = false

    // Periodic cleanup for stale entities (e.g. ADSB tracks)
    const cleanupInterval = setInterval(() => {
      purgeStaleEntities()
    }, 10000) // check every 10 seconds

    const connect = () => {
      if (cancelled) return
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen  = () => setConnected(true)
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        setConnected(false)
        if (!cancelled) setTimeout(connect, RECONNECT_DELAY_MS)
      }

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string)
        switch (msg.type) {
          case 'snapshot':
            setEntities(msg.data)
            break
          case 'entity_update':
            upsertEntity(msg.data)
            break
          case 'feed_update':
          case 'radio_update':
            if (msg.key === 'radio:active' || msg.type === 'radio_update') {
              setRadio(msg.data ?? msg)
            }
            break
          case 'event':
            appendSystemEvent(msg.data)
            break
        }
      }
    }

    connect()
    return () => {
      cancelled = true
      clearInterval(cleanupInterval)
      wsRef.current?.close()
    }
  }, [])
}
