import { useEffect, useRef } from 'react'
import { HEALTH_POLL_MS } from '../config'
import { useCivicPick } from '../store'

export function useSystemHealth() {
  const { setHealth } = useCivicPick('setHealth')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/health')
        if (!res.ok) throw new Error('not ok')
        const data = (await res.json()) as { status: string; redis: boolean }
        setHealth({ ok: data.status === 'ok', redis: data.redis ?? false })
      } catch {
        setHealth({ ok: false, redis: false })
      }
    }

    poll()
    timer.current = setInterval(poll, HEALTH_POLL_MS)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [])
}
