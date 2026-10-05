import type { ReactNode } from 'react'

/**
 * Shared page building blocks so every page reads the same way:
 * header (title + one status line) → at-a-glance tiles → main content.
 */

type Tone = 'default' | 'good' | 'warn' | 'alert' | 'muted' | 'accent'

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-on-surface',
  good:    'text-green-ais',
  warn:    'text-amber-gold',
  alert:   'text-red-emergency',
  muted:   'text-on-surface-variant',
  accent:  'text-amber-gold',
}

/**
 * Page title bar. `status` sits at the right on every size; `controls`
 * (filters, time windows) go inline on desktop and onto their own
 * horizontally-scrolling row on mobile instead of overflowing the header.
 */
export function PageHeader({ icon, iconClass = 'text-amber-gold', title, subtitle, status, controls }: {
  icon: string
  iconClass?: string
  title: string
  subtitle?: ReactNode
  status?: ReactNode
  controls?: ReactNode
}) {
  return (
    <div className="border-b border-amber-gold-muted shrink-0">
      <div className="px-4 lg:px-6 py-3 flex items-center gap-3 min-w-0">
        <span className={`ms text-[20px] leading-none shrink-0 ${iconClass}`} aria-hidden="true" style={{ fontVariationSettings: "'FILL' 1" }}>
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="font-bold text-[15px] lg:text-sm uppercase tracking-tight text-on-surface leading-tight truncate">{title}</h2>
          {subtitle && <div className="text-[12px] text-on-surface-variant leading-snug truncate">{subtitle}</div>}
        </div>
        {controls && <div className="hidden lg:flex items-center gap-2 ml-4 min-w-0">{controls}</div>}
        {status && <div className="ml-auto flex items-center gap-2 shrink-0">{status}</div>}
      </div>
      {controls && (
        <ChipRow className="lg:hidden px-4 pb-3">{controls}</ChipRow>
      )}
    </div>
  )
}

/** Live/state indicator for PageHeader's status slot. */
export function StatusDot({ label, tone = 'good', pulse = true }: { label: string; tone?: Tone; pulse?: boolean }) {
  const dot = tone === 'good' ? 'bg-green-ais' : tone === 'alert' ? 'bg-red-emergency' : tone === 'warn' ? 'bg-amber-gold' : tone === 'accent' ? 'bg-cyan-adsb' : 'bg-outline-variant'
  return (
    <span className={`flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest ${TONE_TEXT[tone]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot} ${pulse ? 'animate-pulse' : ''}`} aria-hidden="true" />
      {label}
    </span>
  )
}

export interface Stat {
  label: string
  value: ReactNode
  tone?: Tone
  hint?: ReactNode
  onClick?: () => void
  active?: boolean
}

/** At-a-glance numbers: 2 across on phones, up to 4 on desktop. */
export function StatTiles({ items, className = '' }: { items: Stat[]; className?: string }) {
  return (
    <div className={`grid grid-cols-2 ${items.length >= 4 ? 'lg:grid-cols-4' : items.length === 3 ? 'lg:grid-cols-3' : ''} gap-2 ${className}`}>
      {items.map((s) => {
        const body = (
          <>
            <div className={`font-mono text-[22px] lg:text-[24px] leading-none ${TONE_TEXT[s.tone ?? 'default']}`}>{s.value}</div>
            <div className="label-caps mt-1.5">{s.label}</div>
            {s.hint && <div className="text-[12px] text-on-surface-variant mt-1 leading-snug">{s.hint}</div>}
          </>
        )
        const cls = `text-left p-3 border bg-surface-container/60 ${s.active ? 'border-amber-gold' : 'border-white/10'}`
        return s.onClick ? (
          <button key={s.label} type="button" onClick={s.onClick} aria-pressed={s.active} className={`${cls} hover:border-amber-gold/60 transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold`}>
            {body}
          </button>
        ) : (
          <div key={s.label} className={cls}>{body}</div>
        )
      })}
    </div>
  )
}

/** One-line empty/idle state — never a tall placeholder box. */
export function EmptyState({ icon, children, className = '' }: { icon: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-3 border border-dashed border-white/10 text-[13px] text-on-surface-variant ${className}`}>
      <span className="ms text-[18px] leading-none opacity-60 shrink-0" aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </div>
  )
}

/** Horizontally-scrolling row of chips/buttons that never wraps or overflows the page. */
export function ChipRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-2 overflow-x-auto no-scrollbar whitespace-nowrap *:shrink-0 ${className}`}>
      {children}
    </div>
  )
}

/** Filter/segment chip used inside ChipRow. */
export function Chip({ active, onClick, children, activeClass = 'bg-amber-gold text-onyx-black border-amber-gold font-bold' }: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  activeClass?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-8 px-3 border font-mono text-[11px] uppercase tracking-widest transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold ${
        active ? activeClass : 'border-white/10 text-on-surface-variant hover:text-on-surface hover:border-white/30'
      }`}
    >
      {children}
    </button>
  )
}

/** Section heading used between blocks of a page. */
export function SectionTitle({ icon, children, aside }: { icon?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="ms text-[16px] text-amber-gold leading-none" aria-hidden="true">{icon}</span>}
      <h3 className="section-heading">{children}</h3>
      {aside && <div className="ml-auto">{aside}</div>}
    </div>
  )
}
