import type { SquawkAlertData } from './types'

const SQUAWK_DEFS = [
  { code: '7500', label: 'Hijack', color: 'text-red-400', border: 'border-red-500/40', bg: 'bg-red-500/10' },
  { code: '7600', label: 'Comm fail', color: 'text-sky-400', border: 'border-sky-500/40', bg: 'bg-sky-500/10' },
  { code: '7700', label: 'Emergency', color: 'text-amber-400', border: 'border-amber-500/40', bg: 'bg-amber-500/10' },
] as const

/** Emergency transponder codes. One quiet line when there are none; big cards only when there is something. */
export function SquawkCounter({ data }: { data: SquawkAlertData | null }) {
  if (!data) return null
  const counts = { '7500': data.squawk_7500, '7600': data.squawk_7600, '7700': data.squawk_7700 } as const
  const hours = data.window_hours ?? 24

  if (data.total === 0) {
    return (
      <section className="border border-white/10 bg-black/30 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="ms text-[18px] text-green-ais" aria-hidden="true">check_circle</span>
        <span className="text-on-surface">No emergency squawks in the last {hours} h</span>
        <span className="font-mono text-[11px] text-on-surface-variant">7500 hijack · 7600 comm fail · 7700 emergency</span>
      </section>
    )
  }
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">
        Emergency squawks <span className="ml-2 normal-case tracking-normal font-normal">last {hours} h</span>
      </h2>
      <div className="grid grid-cols-3 gap-3">
        {SQUAWK_DEFS.map(({ code, label, color, border, bg }) => (
          <div key={code} className={`border ${border} ${counts[code] ? bg : 'border-white/10 opacity-60'} p-3`}>
            <div className="flex items-baseline justify-between">
              <span className={`text-2xl font-mono font-bold ${counts[code] ? color : 'text-on-surface-variant'}`}>{counts[code]}</span>
              <span className="text-[11px] font-mono text-on-surface-variant">{code}</span>
            </div>
            <div className="text-[11px] text-on-surface-variant uppercase tracking-wider">{label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
