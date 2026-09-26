import type { SummaryPosture, SummaryState } from './storeTypes'

const POSTURES: SummaryPosture[] = ['NORMAL', 'ELEVATED', 'HIGH']

/** Normalise a summary:latest payload (REST or WebSocket) into store shape. */
export function parseSummary(data: Record<string, unknown>): SummaryState {
  const posture = typeof data.posture === 'string' && (POSTURES as string[]).includes(data.posture)
    ? (data.posture as SummaryPosture)
    : null
  return {
    summary: typeof data.summary === 'string' ? data.summary : '',
    ts: typeof data.ts === 'string' ? data.ts : null,
    model: typeof data.model === 'string' ? data.model : null,
    posture,
    windowHours: typeof data.window_hours === 'number' ? data.window_hours : null,
    dataGaps: Array.isArray(data.data_gaps)
      ? data.data_gaps.filter((g): g is string => typeof g === 'string')
      : [],
  }
}
