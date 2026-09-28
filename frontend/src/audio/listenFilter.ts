/**
 * Which talkgroups the live P25 player plays on this device. Kept in the
 * browser: it's a listening preference, unlike the shared talkgroup settings.
 */
export type ListenMode = 'priority' | 'all' | 'custom'
export type ListenFilter = { mode: ListenMode; custom: number[] }
export type AudioSource = 'live' | 'stream'

/** "priority" mode plays talkgroups at or above this priority (1 = highest). */
export const LISTEN_PRIORITY_CUTOFF = 2

const FILTER_KEY = 'vertex.p25.listen'
const SOURCE_KEY = 'vertex.audio.source'
const DEFAULT_FILTER: ListenFilter = { mode: 'priority', custom: [] }

type TgPriority = { tgid: number; priority: number }

export function loadListenFilter(): ListenFilter {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null')
    if (f && ['priority', 'all', 'custom'].includes(f.mode) && Array.isArray(f.custom)) {
      return { mode: f.mode, custom: f.custom.filter((n: unknown) => typeof n === 'number') }
    }
  } catch { /* storage unavailable */ }
  return DEFAULT_FILTER
}

export function saveListenFilter(f: ListenFilter) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)) } catch { /* storage unavailable */ }
}

export function loadAudioSource(): AudioSource {
  try { return localStorage.getItem(SOURCE_KEY) === 'stream' ? 'stream' : 'live' } catch { return 'live' }
}

export function saveAudioSource(s: AudioSource) {
  try { localStorage.setItem(SOURCE_KEY, s) } catch { /* storage unavailable */ }
}

/** tgid → should it play? tgid 0 (never labelled) only plays in "all". */
export function makeWants(f: ListenFilter, talkgroups: TgPriority[]): (tgid: number) => boolean {
  if (f.mode === 'all') return () => true
  if (f.mode === 'custom') {
    const set = new Set(f.custom)
    return (tgid) => set.has(tgid)
  }
  const set = new Set(talkgroups.filter((t) => t.priority <= LISTEN_PRIORITY_CUTOFF).map((t) => t.tgid))
  return (tgid) => set.has(tgid)
}

/** Queue order for held calls: talkgroup priority, unknown talkgroups last. */
export function makePriorityOf(talkgroups: TgPriority[]): (tgid: number) => number {
  const map = new Map(talkgroups.map((t) => [t.tgid, t.priority]))
  return (tgid) => (tgid ? map.get(tgid) ?? 3 : 6)
}
