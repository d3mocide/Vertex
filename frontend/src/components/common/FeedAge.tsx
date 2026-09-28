import { useEffect, useState } from 'react'
import { useCivicPick } from '../../store'

/** "just now" / "4m ago" / "2h ago" / "3d ago" from an age in seconds. */
export function formatAge(ageS: number): string {
  if (ageS < 60) return 'just now'
  if (ageS < 3600) return `${Math.floor(ageS / 60)}m ago`
  if (ageS < 172800) return `${Math.floor(ageS / 3600)}h ago`
  return `${Math.floor(ageS / 86400)}d ago`
}

export type Freshness = 'fresh' | 'stale' | 'dead' | 'unknown'

/** Age and freshness of a feed from its last-update time and stale threshold. */
export function useFeedFreshness(feedKey: string): { ageS: number | null; state: Freshness } {
  const { feedMeta } = useCivicPick('feedMeta')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const entry = feedMeta[feedKey]
  if (!entry?.ts) return { ageS: null, state: 'unknown' }
  const ageS = Math.max(0, (now - Date.parse(entry.ts)) / 1000)
  const max = entry.max_age_s
  if (!max) return { ageS, state: 'fresh' }
  return { ageS, state: ageS > max * 3 ? 'dead' : ageS > max ? 'stale' : 'fresh' }
}

const STATE_CLASS: Record<Freshness, { dot: string; text: string }> = {
  fresh:   { dot: 'bg-green-ais',                    text: 'text-on-surface-variant' },
  stale:   { dot: 'bg-amber-gold',                   text: 'text-amber-gold' },
  dead:    { dot: 'bg-red-emergency animate-pulse',  text: 'text-red-emergency' },
  unknown: { dot: 'bg-outline-variant',              text: 'text-on-surface-variant' },
}

/**
 * Real data age for a feed ("updated 4m ago"), coloured by staleness —
 * replaces hard-coded "Live" / "Just now" labels that were shown regardless
 * of whether the source was still delivering.
 */
export function FeedAge({ feedKey, prefix = 'Updated', className = '' }: {
  feedKey: string
  prefix?: string
  className?: string
}) {
  const { ageS, state } = useFeedFreshness(feedKey)
  const cls = STATE_CLASS[state]
  const label = ageS == null ? 'no data yet' : `${prefix ? prefix + ' ' : ''}${formatAge(ageS)}${state === 'stale' || state === 'dead' ? ' · stale' : ''}`
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono uppercase ${cls.text} ${className}`}
      title={ageS == null ? `${feedKey}: no update recorded` : `${feedKey}: last update ${formatAge(ageS)}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cls.dot}`} aria-hidden="true" />
      {label}
    </span>
  )
}
