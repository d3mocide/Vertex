import { useSyncExternalStore } from 'react'
import { getRuns, subscribeRuns } from './devState'
import type { PerfSummary } from '../perfRecorder'

/** Every recording made since the page loaded (or since Clear), oldest first. */
export function useRuns(): PerfSummary[] {
  return useSyncExternalStore(subscribeRuns, () => getRuns<PerfSummary>())
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}
