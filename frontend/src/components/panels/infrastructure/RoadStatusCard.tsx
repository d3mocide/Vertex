import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'

interface Corridor {
  road: string
  dir: string
  label: string
  status: 'normal' | 'slow' | 'heavy' | 'quiet' | 'nodata'
  speed: number | null
  stations: number
  reporting: number
  slowest: { loc: string; speed: number } | null
}

const DOT: Record<Corridor['status'], string> = {
  normal: 'bg-green-ais',
  quiet: 'bg-green-ais',
  slow: 'bg-amber-gold animate-pulse',
  heavy: 'bg-red-emergency animate-pulse',
  nodata: 'bg-on-surface-variant',
}
const WORD: Record<Corridor['status'], string> = {
  normal: 'Flowing', quiet: 'Quiet', slow: 'Slow', heavy: 'Heavy', nodata: 'No data',
}
const TONE: Record<Corridor['status'], string> = {
  normal: 'text-on-surface', quiet: 'text-on-surface-variant', slow: 'text-amber-gold', heavy: 'text-red-emergency', nodata: 'text-on-surface-variant',
}

// Matches the poller: a corridor whose median is above this but has crawling spots is a "slow spot".
const SLOW_MPH = 45

// "Greeley (2DS112) to NB I-5 MP303.1" → "Greeley"
const place = (loc: string) => loc.replace(/\s*\(.*$/, '').replace(/\s+(to|@)\s+.*$/i, '').trim()

/**
 * Freeway speed by road and direction, from every mainline detector near us. Trouble comes first
 * (with where the slowest spot is); a corridor that is flowing is one quiet line.
 */
export function RoadStatusCard() {
  const [corridors, setCorridors] = useState<Corridor[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/traffic/corridors`, { headers: authHeaders() })
        if (res.ok) setCorridors(await res.json())
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 60 * 1000)
    return () => clearInterval(t)
  }, [])

  if (corridors.length === 0) return null

  const rank = (c: Corridor) => ({ heavy: 0, slow: 1, normal: 2, quiet: 2, nodata: 3 }[c.status])
  const sorted = [...corridors].sort((a, b) => rank(a) - rank(b))
  const troubled = sorted.filter((c) => c.status === 'heavy' || c.status === 'slow')

  const rows = sorted.map((c) => (
    <div key={c.label} className="py-1.5 border-b border-amber-gold-muted/20 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-on-surface">{c.label}</span>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[11px] ${TONE[c.status]}`}>
            {c.status === 'slow' && (c.speed ?? 0) >= SLOW_MPH ? 'Slow spot' : WORD[c.status]}
            {c.speed != null && c.status !== 'quiet' && !(c.status === 'slow' && c.speed >= SLOW_MPH) ? ` · ${c.speed} mph` : ''}
          </span>
          <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[c.status]}`} aria-label={`Status: ${WORD[c.status]}`} />
        </div>
      </div>
      {(c.status === 'slow' || c.status === 'heavy') && c.slowest && (
        <div className="font-mono text-[11px] text-on-surface-variant mt-0.5">
          slowest: {place(c.slowest.loc)} · {c.slowest.speed} mph
        </div>
      )}
    </div>
  ))

  const heading = (
    <span className="label-caps flex items-center gap-2 flex-1">
      <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">traffic</span>
      FREEWAYS
      <span className={`ml-auto font-mono text-[11px] normal-case tracking-normal ${troubled.length ? 'text-amber-gold' : 'text-green-ais'}`}>
        {troubled.length ? `${troubled.length} corridor${troubled.length === 1 ? '' : 's'} slow` : `All ${sorted.length} flowing`}
      </span>
    </span>
  )

  // Trouble stays open. When everything is flowing the twelve identical lines fold away.
  return troubled.length > 0 ? (
    <div className="hud-panel p-3">
      <div className="mb-2 flex">{heading}</div>
      {rows}
    </div>
  ) : (
    <details className="hud-panel p-3 group">
      <summary className="cursor-pointer list-none flex items-center gap-2">
        {heading}
        <span className="ms text-[16px] leading-none text-on-surface-variant group-open:rotate-180 transition-transform" aria-hidden="true">expand_more</span>
      </summary>
      <div className="mt-2">{rows}</div>
    </details>
  )
}
