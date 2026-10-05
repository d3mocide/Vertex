import type { OverviewData, OverviewIssue } from './types'

type Tab = OverviewIssue['tab']

const STYLE = {
  ok:       { dot: 'bg-green-ais',      text: 'text-green-ais',      border: 'border-green-ais/40',      bg: 'bg-green-ais/5',      label: 'All systems normal' },
  warning:  { dot: 'bg-amber-gold',     text: 'text-amber-gold',     border: 'border-amber-gold/40',     bg: 'bg-amber-gold/5',     label: 'Needs attention' },
  critical: { dot: 'bg-red-emergency',  text: 'text-red-emergency',  border: 'border-red-emergency/50',  bg: 'bg-red-emergency/5',  label: 'Action needed' },
} as const

const ICON = { critical: 'error', warning: 'warning', info: 'info' } as const
const ICON_COLOR = { critical: 'text-red-emergency', warning: 'text-amber-gold', info: 'text-on-surface-variant' } as const
const TAB_LABEL: Record<Tab, string> = { system: 'System', ingestion: 'Ingest', quality: 'Quality', storage: 'Storage', events: 'Events' }

/** The answer to "is anything wrong?": one verdict, then only the things that need a human. */
export function AttentionBanner({ overview, onGoto }: { overview: OverviewData | null; onGoto: (tab: Tab) => void }) {
  if (!overview) {
    return <div className="border border-white/10 bg-black/30 p-4 text-xs text-on-surface-variant">Checking…</div>
  }
  const st = STYLE[overview.status]
  const actionable = overview.issues.filter((i) => i.severity !== 'info')
  const info = overview.issues.filter((i) => i.severity === 'info')

  return (
    <section className={`border ${st.border} ${st.bg} p-4 stack-y-3`} role="status">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} aria-hidden="true" />
        <h2 className={`font-bold text-sm uppercase tracking-widest ${st.text}`}>
          {overview.status === 'ok' ? st.label : `${st.label} · ${actionable.length}`}
        </h2>
        <span className="text-[11px] text-on-surface-variant font-mono">
          checked {new Date(overview.checked_at * 1000).toLocaleTimeString()}
        </span>
      </div>

      {actionable.length > 0 && (
        <ul className="stack-y-2">
          {actionable.map((i, n) => (
            <li key={`${i.area}-${n}`} className="flex items-start gap-3 border-t border-white/10 pt-2">
              <span className={`ms text-[18px] shrink-0 ${ICON_COLOR[i.severity]}`} aria-hidden="true">{ICON[i.severity]}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-on-surface font-medium">{i.title}</div>
                {i.detail && <div className="text-[12px] text-on-surface-variant">{i.detail}</div>}
              </div>
              {i.tab !== 'system' && (
                <button type="button" onClick={() => onGoto(i.tab)}
                  className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-amber-gold hover:underline">
                  {TAB_LABEL[i.tab]} ›
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {info.map((i, n) => (
        <div key={`info-${n}`} className="flex items-center gap-2 text-[12px] text-on-surface-variant">
          <span className={`ms text-[16px] ${ICON_COLOR.info}`} aria-hidden="true">info</span>
          {i.title} — {i.detail}
        </div>
      ))}
    </section>
  )
}
