import type { ReactNode } from 'react'

/**
 * Shared pieces for the Dashboard and Wall Display: the frosted panel, the ambient backdrop the
 * panels blur over, and small pure-SVG charts. Colours come from text-* token classes through
 * `currentColor`, so nothing here hardcodes a hex value.
 */

/** Frosted HUD panel with a title row. `tone` tints the top edge for live/alert states. */
export function GlassCard({
  icon,
  title,
  titleClass = 'text-amber-gold',
  iconClass = 'text-amber-gold',
  right,
  children,
  className = '',
  bodyClass = '',
  ariaLabel,
  tone,
}: {
  icon: string
  title: string
  titleClass?: string
  iconClass?: string
  right?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
  ariaLabel?: string
  tone?: 'red' | 'amber' | 'p25'
}) {
  const edge = tone === 'red'
    ? 'border-t-red-emergency/70'
    : tone === 'amber'
      ? 'border-t-amber-gold/60'
      : tone === 'p25'
        ? 'border-t-amber-p25/70'
        : 'border-t-white/15'
  return (
    <section
      className={`relative pointer-events-auto flex flex-col min-h-0 bg-white/4 backdrop-blur-md border border-white/10 border-t ${edge} shadow-[0_8px_32px_rgba(0,0,0,0.45)] ${className}`}
      aria-label={ariaLabel ?? title}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/6 bg-white/3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`ms text-[15px] leading-none ${iconClass}`} aria-hidden="true">{icon}</span>
          <h2 className={`section-heading mb-0! truncate ${titleClass}`}>{title}</h2>
        </div>
        {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
      </div>
      <div className={`flex-1 min-h-0 ${bodyClass}`}>{children}</div>
    </section>
  )
}

/** "Open the full page" link used in card headers. */
export function CardLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-hidden focus-visible:text-amber-gold"
    >
      {label} →
    </button>
  )
}

/**
 * Ambient layer behind the dashboard. The live map is slotted into one panel, so without this the
 * frosted panels would blur flat black: a faint scope grid and soft light give the glass something
 * to diffuse, the way the map does on the Map tab.
 */
export function DashboardBackdrop() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0 opacity-[0.09]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div
        className="absolute -top-1/3 -left-1/4 w-[70vw] h-[70vh] opacity-60"
        style={{ background: 'radial-gradient(closest-side, rgba(255,184,0,0.10), transparent)' }}
      />
      <div
        className="absolute -bottom-1/3 -right-1/4 w-[70vw] h-[80vh] opacity-60"
        style={{ background: 'radial-gradient(closest-side, rgba(140,160,190,0.10), transparent)' }}
      />
    </div>
  )
}

/**
 * 24 hourly bars, oldest first, the current (partial) hour last and drawn brighter. Colour from
 * `className` (a text-* token). Hover a bar for its count.
 */
export function HourBars({
  values,
  className = 'text-amber-gold',
  height = 28,
  label,
}: {
  values: number[]
  className?: string
  height?: number
  label: string
}) {
  const n = values.length
  if (n === 0) return <div style={{ height }} />
  // One freak hour (a burst of mesh adverts, say) would flatten every other bar. When the peak is more than
  // three times the next-highest hour, scale to that hour instead and draw the peak clipped, its top marked.
  const sorted = [...values].sort((a, b) => b - a)
  const clipAt = sorted.length > 1 && sorted[1] > 0 && sorted[0] > sorted[1] * 3 ? sorted[1] * 1.25 : null
  const max = Math.max(clipAt ?? sorted[0] ?? 0, 1)
  const gap = 1
  const w = 100 / n
  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className={`w-full block ${className}`}
      style={{ height }}
      role="img"
      aria-label={label}
    >
      {values.map((v, i) => {
        const clipped = v > max
        const h = v > 0 ? Math.max(1.5, (Math.min(v, max) / max) * (height - 2)) : 0.75
        const last = i === n - 1
        const x = i * w + gap / 2
        const bw = Math.max(0.5, w - gap)
        return (
          <g key={i}>
            <rect x={x} y={height - h} width={bw} height={h} fill="currentColor" opacity={v > 0 ? (last ? 1 : 0.55) : 0.18}>
              <title>{`${n - 1 - i === 0 ? 'This hour' : `${n - 1 - i}h ago`}: ${v}${clipped ? ' (off scale)' : ''}`}</title>
            </rect>
            {clipped && <rect x={x} y={0} width={bw} height={2} fill="currentColor" opacity={1} />}
          </g>
        )
      })}
    </svg>
  )
}

/** A compact horizontal share bar: value against max. */
export function ShareBar({ value, max, className = 'bg-amber-p25' }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="h-1 w-full bg-white/6" aria-hidden="true">
      <div className={`h-full ${className}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

/**
 * Today against the usual: a bar for the count and a tick at the baseline. Amber when well above
 * usual, so a surge reads without reading numbers.
 */
export function BaselineBar({ count, usual, flag }: { count: number; usual: number | null; flag: boolean }) {
  const max = Math.max(count, usual ?? 0, 1) * 1.15
  const pct = (count / max) * 100
  const tick = usual != null ? (usual / max) * 100 : null
  return (
    <div className="relative h-1.5 w-full bg-white/6" aria-hidden="true">
      <div className={`h-full ${flag ? 'bg-amber-gold' : 'bg-on-surface-variant/60'}`} style={{ width: `${pct}%` }} />
      {tick != null && <div className="absolute -top-0.5 -bottom-0.5 w-px bg-on-surface" style={{ left: `${tick}%` }} />}
    </div>
  )
}
