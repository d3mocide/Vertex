import { useState, type ReactNode } from 'react'
import type { RadioIncidentFeed, SummaryPosture } from '../../../storeTypes'
import { CATEGORY } from '../RadioIncidents'
import type { RadioIncidentCategory } from '../../../storeTypes'
import { formatRelativeAge, type BriefingDigest, type BriefingPoint, type SituationItem } from './useDashboardData'
import { BaselineBar, HourBars, ShareBar } from './ui'
import { hourLabel, type DashboardHistory, type EmsFeed, type Forecast } from './feeds'

type Size = 'desk' | 'wall'

export function postureClass(posture: SummaryPosture): string {
  if (posture === 'HIGH') return 'border-red-emergency bg-red-emergency/15 text-red-emergency'
  if (posture === 'ELEVATED') return 'border-amber-gold bg-amber-gold/10 text-amber-gold'
  return 'border-green-ais/60 bg-green-ais/10 text-green-ais'
}

// ── KPI tile: a live number, its 24 h total and the hourly shape of the day ──
export function KpiTile({
  icon,
  label,
  now,
  nowLabel,
  total,
  totalLabel = '24H',
  series,
  colorClass,
  extra,
  size = 'desk',
  axis = ['-24H', '-12H', 'NOW'],
  seriesLabel,
}: {
  icon: string
  label: string
  now: string | number
  nowLabel?: string
  total?: number | null
  totalLabel?: string
  series?: number[] | null
  colorClass: string
  extra?: ReactNode
  size?: Size
  axis?: [string, string, string]
  seriesLabel?: string
}) {
  const big = size === 'wall'
  return (
    <div className="pointer-events-auto min-w-0 bg-white/4 backdrop-blur-md border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.45)] px-3 pt-2 pb-1.5 flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={`ms text-[14px] leading-none ${colorClass}`} aria-hidden="true">{icon}</span>
          <span className="label-caps truncate">{label}</span>
        </span>
        {total != null && (
          <span className="font-mono text-[10px] text-on-surface-variant shrink-0">
            {total.toLocaleString()} <span className="opacity-70">{totalLabel}</span>
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className={`font-mono font-bold leading-none ${colorClass} ${big ? 'text-[30px]' : 'text-[22px]'}`}>{now}</span>
        {nowLabel && <span className="font-mono text-[10px] uppercase text-on-surface-variant truncate">{nowLabel}</span>}
      </div>
      {extra && <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">{extra}</div>}
      {series && series.length > 0 && (
        <div className="mt-1.5">
          <HourBars values={series} className={colorClass} height={big ? 30 : 22} label={seriesLabel ?? `${label}, last 24 hours by hour`} />
          <div className="flex justify-between font-mono text-[8px] text-on-surface-variant/70 mt-0.5" aria-hidden="true">
            {axis.map((a) => <span key={a}>{a}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── AI briefing digest ───────────────────────────────────────────────────────
function Point({ p, size }: { p: BriefingPoint; size: Size }) {
  return (
    <li className={`flex gap-2 ${size === 'wall' ? 'text-[14px]' : 'text-[12px]'} leading-snug text-on-surface`}>
      <span className="mt-[0.45em] w-1 h-1 bg-amber-gold shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        {p.label && <span className="font-bold text-amber-gold">{p.label}: </span>}
        {p.text}
      </span>
    </li>
  )
}

export function BriefingView({
  digest,
  ts,
  nowMs,
  size = 'desk',
  maxPoints,
}: {
  digest: BriefingDigest | null
  ts: string | null
  nowMs: number
  size?: Size
  maxPoints?: number
}) {
  const [showAll, setShowAll] = useState(false)
  if (!digest) {
    return <div className="px-3 py-3 font-mono text-[11px] text-on-surface-variant">No briefing generated yet.</div>
  }
  const wall = size === 'wall'
  const changes = digest.changes
  const devs = digest.developments
  const limit = maxPoints ?? (wall ? 4 : 3)
  const shownDevs = showAll ? devs : devs.slice(0, limit)
  return (
    <div className={wall ? 'px-4 py-3' : 'px-3 py-2.5'}>
      <p className={`${wall ? 'text-[17px]' : 'text-[13px]'} font-semibold leading-snug text-white`}>
        {digest.bottomLine}
      </p>
      {ts && (
        <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant mt-1">
          Generated {formatRelativeAge(ts, nowMs)} ago
        </div>
      )}
      {changes.length > 0 && (
        <div className="mt-2.5">
          <div className="label-caps mb-1">Since last briefing</div>
          <ul className="stack-y-1">
            {changes.slice(0, wall ? 1 : 3).map((p, i) => <Point key={`c${i}`} p={p} size={size} />)}
          </ul>
        </div>
      )}
      {devs.length > 0 && (
        <div className="mt-2.5">
          <div className="label-caps mb-1">Key developments</div>
          <ul className="stack-y-1">
            {shownDevs.map((p, i) => <Point key={`d${i}`} p={p} size={size} />)}
          </ul>
        </div>
      )}
      {!wall && (showAll || devs.length > limit || digest.outlook.length > 0 || digest.risks.length > 0) && (
        <>
          {showAll && digest.risks.length > 0 && (
            <div className="mt-2.5">
              <div className="label-caps mb-1">Compound risks</div>
              <ul className="stack-y-1">{digest.risks.map((p, i) => <Point key={`r${i}`} p={p} size={size} />)}</ul>
            </div>
          )}
          {showAll && digest.outlook.length > 0 && (
            <div className="mt-2.5">
              <div className="label-caps mb-1">Next 24 hours</div>
              <ul className="stack-y-1">{digest.outlook.map((p, i) => <Point key={`o${i}`} p={p} size={size} />)}</ul>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-2 font-mono text-[10px] uppercase tracking-widest text-amber-gold hover:text-white transition-colors"
          >
            {showAll ? 'Show less' : 'Full briefing'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Situation board ──────────────────────────────────────────────────────────
const TONE_ROW: Record<SituationItem['tone'], string> = {
  red: 'border-l-red-emergency bg-red-emergency/10',
  amber: 'border-l-amber-gold',
  neutral: 'border-l-white/15',
}
const TONE_TEXT: Record<SituationItem['tone'], string> = {
  red: 'text-red-emergency',
  amber: 'text-amber-gold',
  neutral: 'text-on-surface-variant',
}

export function SituationCounts({ items }: { items: SituationItem[] }) {
  const count = (k: SituationItem['kind']) => items.filter((i) => i.kind === k).length
  const parts: [string, number][] = [
    ['DISPATCH', count('dispatch')],
    ['WX', count('nws')],
    ['TRAFFIC', count('traffic')],
    ['OTHER', count('advisory')],
  ]
  return (
    <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
      {parts.filter(([, n]) => n > 0).map(([l, n]) => `${n} ${l}`).join(' · ') || 'NONE'}
    </span>
  )
}

export function SituationList({
  items,
  nowMs,
  onSelect,
  limit,
  size = 'desk',
  emptyText = 'All clear: no active dispatch, weather alerts or traffic incidents nearby.',
}: {
  items: SituationItem[]
  nowMs: number
  onSelect?: (item: SituationItem) => void
  limit?: number
  size?: Size
  emptyText?: string
}) {
  const wall = size === 'wall'
  if (items.length === 0) {
    return (
      <div className={`m-3 px-3 py-2.5 border-l-2 border-l-green-ais bg-green-ais/8 font-mono ${wall ? 'text-[13px]' : 'text-[11px]'} text-green-ais flex items-center gap-2`}>
        <span className="w-2 h-2 rounded-full bg-green-ais shrink-0" aria-hidden="true" />
        {emptyText}
      </div>
    )
  }
  const shown = limit ? items.slice(0, limit) : items
  return (
    <div className="divide-y divide-white/5">
      {shown.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onSelect?.(it)}
          className={`w-full text-left ${wall ? 'px-3.5 py-2' : 'px-3 py-1.5'} flex items-start gap-2.5 border-l-2 hover:bg-white/5 transition-colors focus:outline-hidden focus-visible:bg-white/5 ${TONE_ROW[it.tone]}`}
        >
          <span className={`ms ${wall ? 'text-[18px]' : 'text-[15px]'} leading-none mt-0.5 shrink-0 ${TONE_TEXT[it.tone]}`} aria-hidden="true">{it.icon}</span>
          <span className="min-w-0 flex-1">
            <span className={`block ${wall ? 'text-[14px]' : 'text-[12px]'} font-semibold text-on-surface truncate`}>{it.title}</span>
            {it.detail && (
              <span className={`block font-mono ${wall ? 'text-[11px]' : 'text-[10px]'} text-on-surface-variant truncate mt-0.5`}>{it.detail}</span>
            )}
          </span>
          <span className="font-mono text-[10px] text-right shrink-0 leading-tight">
            <span className={`block font-bold ${TONE_TEXT[it.tone]}`}>{it.source}</span>
            <span className="block text-on-surface-variant">
              {[it.distKm != null ? `${it.distKm.toFixed(0)} km` : null, it.ts ? formatRelativeAge(it.ts, nowMs) : null]
                .filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
      ))}
      {limit && items.length > limit && (
        <div className="px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          +{items.length - limit} more
        </div>
      )}
    </div>
  )
}

// ── Forecast: next 12 hours and the next periods ─────────────────────────────
export function ForecastView({ forecast, size = 'desk', hours = 12 }: { forecast: Forecast | null; size?: Size; hours?: number }) {
  if (!forecast || forecast.hourly.length === 0) {
    return <div className="px-3 py-3 font-mono text-[11px] text-on-surface-variant">Forecast loading…</div>
  }
  const wall = size === 'wall'
  const now = Date.now()
  const hrs = forecast.hourly.filter((h) => Date.parse(h.ts) >= now - 3_600_000).slice(0, hours)
  const temps = hrs.map((h) => h.temp_f).filter((t): t is number => t != null)
  const tMin = Math.min(...temps)
  const tMax = Math.max(...temps)
  const span = Math.max(1, tMax - tMin)
  // A few degrees across the window draws a flat row of dots that says nothing; show the trend only when it moves.
  const showTrend = temps.length > 1 && tMax - tMin >= 6
  return (
    <div className={wall ? 'px-3.5 py-2' : 'px-3 py-2'}>
      <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${hrs.length}, minmax(0, 1fr))` }}>
        {hrs.map((h) => {
          const pop = h.pop ?? 0
          const tPct = h.temp_f != null ? ((h.temp_f - tMin) / span) * 100 : 0
          return (
            <div key={h.ts} className="flex flex-col items-center min-w-0" title={`${hourLabel(h.ts)} · ${h.short}`}>
              <span className={`font-mono ${wall ? 'text-[12px]' : 'text-[11px]'} font-bold text-on-surface`}>
                {h.temp_f != null ? `${h.temp_f}°` : '—'}
              </span>
              {showTrend && (
                <div className="relative w-full h-6 mt-0.5" aria-hidden="true">
                  <div className="absolute left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-on-surface" style={{ bottom: `${tPct * 0.75}%` }} />
                </div>
              )}
              <div className={`w-full ${showTrend ? 'h-7' : 'h-10 mt-1'} flex items-end px-[15%]`} aria-hidden="true">
                <div className={`w-full ${pop >= 50 ? 'bg-on-surface/35 border-t border-on-surface/70' : 'bg-white/10'}`} style={{ height: `${Math.max(4, pop)}%` }} />
              </div>
              <span className={`font-mono text-[9px] ${pop >= 50 ? 'text-on-surface' : 'text-on-surface-variant'}`}>{pop}%</span>
              <span className="font-mono text-[9px] text-on-surface-variant">{hourLabel(h.ts)}</span>
            </div>
          )
        })}
      </div>
      {forecast.periods.length > 0 && (
        <div className={`grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-white/6`}>
          {forecast.periods.slice(0, 3).map((p) => (
            <div key={p.name} className="min-w-0">
              <div className="label-caps truncate">{p.name}</div>
              <div className="font-mono text-[13px] font-bold text-on-surface">
                {p.temp_f != null ? `${p.temp_f}°` : '—'}
                {p.pop != null && p.pop > 0 && <span className="text-[10px] font-normal text-on-surface-variant"> · {p.pop}%</span>}
              </div>
              <div className="text-[10px] text-on-surface-variant truncate" title={p.detail ?? p.short}>{p.short}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Dispatch mix (24 h) against the usual, and EMS syndromes ─────────────────
export function DispatchMixView({
  feed,
  history,
  ems,
}: {
  feed: RadioIncidentFeed | null
  history: DashboardHistory | null
  ems: EmsFeed | null
}) {
  const byCat = feed?.by_category ?? {}
  const base = feed?.baseline && !feed.baseline.building ? feed.baseline.categories : null
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const max = Math.max(1, ...cats.map(([, n]) => n))
  const syndromes = (ems?.syndromes ?? []).filter((s) => s.count > 0 || s.flag).slice(0, 6)
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="label-caps">Dispatch by type · 24h</span>
          <span className="font-mono text-[10px] text-on-surface-variant">
            {feed?.incident_count ?? 0} incidents{history ? ` · ${history.life_safety_24h} life-safety` : ''}
          </span>
        </div>
        {cats.length === 0 ? (
          <div className="font-mono text-[11px] text-on-surface-variant">No dispatch incidents extracted yet.</div>
        ) : (
          <ul className="stack-y-1.5">
            {cats.map(([key, n]) => {
              const meta = CATEGORY[key as RadioIncidentCategory]
              const usual = base?.[key]?.usual ?? null
              const flag = Boolean(base?.[key]?.flag)
              return (
                <li key={key} className="min-w-0">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex items-center gap-1.5 min-w-0 text-on-surface truncate">
                      <span className="ms text-[13px] leading-none text-on-surface-variant" aria-hidden="true">{meta?.icon ?? 'radio'}</span>
                      {meta?.label ?? key}
                    </span>
                    <span className={`font-mono shrink-0 ${flag ? 'text-amber-gold font-bold' : 'text-on-surface'}`}>
                      {n}
                      {usual != null && <span className="text-on-surface-variant font-normal"> / ~{Math.round(usual)}</span>}
                    </span>
                  </div>
                  {usual != null ? <BaselineBar count={n} usual={usual} flag={flag} /> : <ShareBar value={n} max={max} className="bg-amber-p25/70" />}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="label-caps">EMS calls vs usual · 24h</span>
          {ems && (
            <span className="font-mono text-[10px] text-on-surface-variant">
              {ems.reports}{ems.reports_baseline != null ? ` / ~${Math.round(ems.reports_baseline)}` : ''} reports
            </span>
          )}
        </div>
        {!ems ? (
          <div className="font-mono text-[11px] text-on-surface-variant">EMS activity loading…</div>
        ) : ems.building ? (
          <div className="font-mono text-[11px] text-on-surface-variant">Building a {ems.baseline_days}-day baseline.</div>
        ) : syndromes.length === 0 ? (
          <div className="font-mono text-[11px] text-on-surface-variant">No EMS reports classified in the last 24 h.</div>
        ) : (
          <ul className="stack-y-1.5">
            {syndromes.map((s) => (
              <li key={s.key} className="min-w-0">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className={`truncate ${s.flag ? 'text-amber-gold font-semibold' : 'text-on-surface'}`}>
                    {s.label}{s.flag ? ' · ABOVE USUAL' : ''}
                  </span>
                  <span className="font-mono shrink-0 text-on-surface">
                    {s.count}
                    {s.baseline != null && <span className="text-on-surface-variant"> / ~{Math.round(s.baseline)}</span>}
                  </span>
                </div>
                <BaselineBar count={s.count} usual={s.baseline} flag={s.flag} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Busiest talkgroups (24 h) ────────────────────────────────────────────────
export function TalkgroupBars({ history }: { history: DashboardHistory | null }) {
  const tgs = history?.talkgroups ?? []
  if (tgs.length === 0) return null
  const max = Math.max(1, ...tgs.map((t) => t.calls))
  return (
    <div className="px-3 py-2 border-t border-white/6">
      <div className="label-caps mb-1">Busiest talkgroups · 24h</div>
      <ul className="stack-y-1">
        {tgs.map((t) => (
          <li key={t.tgid} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 items-center">
            <span className="font-mono text-[10px] text-amber-p25 truncate">{t.label || `TG ${t.tgid}`}</span>
            <span className="font-mono text-[10px] text-on-surface-variant">{t.calls}</span>
            <div className="col-span-2"><ShareBar value={t.calls} max={max} className="bg-amber-p25/70" /></div>
          </li>
        ))}
      </ul>
    </div>
  )
}
