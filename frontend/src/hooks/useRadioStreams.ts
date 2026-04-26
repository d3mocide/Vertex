import { useEffect, useState } from 'react'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

export type RadioStream = {
  id: number
  name: string
  url: string
  format: string
  enabled: boolean
  source: string
}

export function useRadioStreams() {
  const [streams, setStreams] = useState<RadioStream[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/radio/streams`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: RadioStream[]) => {
        setStreams(data)
        // Auto-select the first enabled stream if none selected
        const first = data.find((s) => s.enabled)
        if (first) setSelectedId(first.id)
      })
      .catch(() => setStreams([]))
  }, [])

  const selectedStream = streams.find((s) => s.id === selectedId) ?? null

  return { streams, selectedId, setSelectedId, selectedStream }
}
