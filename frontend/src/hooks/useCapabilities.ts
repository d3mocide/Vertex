import { useSyncExternalStore } from 'react'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

/** What the backend reports for each regional data contract (see docs/contracts). */
export type ContractStatus = 'ok' | 'stale' | 'down' | 'pending' | 'none'

export interface ContractCapability {
  title: string
  providers: string[]
  status: ContractStatus
  reason: 'outside_coverage' | 'not_configured' | null
  requires?: string
  updated_age_s: number | null
}

export interface Capabilities {
  region: {
    name: string
    center: [number, number]
    bbox: { min_lat: number; max_lat: number; min_lon: number; max_lon: number }
    timezone: string
  }
  pack: string | null
  contracts: Record<string, ContractCapability>
}

// One shared fetch for the whole app, refreshed every few minutes.
const REFRESH_MS = 5 * 60 * 1000
let current: Capabilities | null = null
const listeners = new Set<() => void>()
let timer: number | undefined

async function load() {
  try {
    const res = await fetch(`${API_BASE}/capabilities`, { headers: authHeaders() })
    if (!res.ok) return
    current = (await res.json()) as Capabilities
    listeners.forEach((l) => l())
  } catch {
    // Keep the last known value; the UI treats "unknown" as available.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    void load()
    timer = window.setInterval(load, REFRESH_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer)
      timer = undefined
    }
  }
}

/** The full capabilities document, or null until the first response arrives. */
export function useCapabilities(): Capabilities | null {
  return useSyncExternalStore(subscribe, () => current, () => null)
}

/**
 * Whether a regional contract has a provider here. Until capabilities load — or if the
 * request fails — a contract counts as available, so nothing flashes away or disappears
 * because of a network hiccup.
 */
export function useContractAvailable(id: string): boolean {
  const caps = useCapabilities()
  if (!caps) return true
  const c = caps.contracts[id]
  return !c || c.status !== 'none'
}
