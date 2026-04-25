import { useEffect, useRef } from 'react'
import { WS_URL } from '../config'
import { useCivicStore } from '../store'
import { wsTokenParam } from '../auth'
import { initNotifications, maybeNotify } from '../notifications'

const RECONNECT_DELAY_MS = 3000

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const { setEntities, upsertEntity, purgeStaleEntities, setConnected, setRadio, appendSystemEvent, setUtilityStatus, setOregonStatus } = useCivicStore()

  useEffect(() => {
    let cancelled = false

    initNotifications()

    const cleanupInterval = setInterval(() => {
      purgeStaleEntities()
    }, 10000)

    const connect = () => {
      if (cancelled) return
      const ws = new WebSocket(WS_URL + wsTokenParam())
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
            } else if (msg.key === 'utility:pge') {
              setUtilityStatus(msg.data)
            } else if (msg.key === 'utility:oregon') {
              setOregonStatus(msg.data)
            }
            break
          case 'event':
            appendSystemEvent(msg.data)
            maybeNotify(msg.data)
            break
        }
      }
    }

    connect()
    return () => {
      cancelled = true
      clearInterval(cleanupInterval)
      if (wsRef.current) {
        wsRef.current.onopen = null
        wsRef.current.onerror = null
        wsRef.current.onclose = null
        wsRef.current.onmessage = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])
}
