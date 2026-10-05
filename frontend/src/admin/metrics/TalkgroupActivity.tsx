import { useState } from 'react'
import type { TalkgroupActivityData } from './types'

const TOP = 10

export function TalkgroupActivity({ data }: { data: TalkgroupActivityData | null }) {
  const [all, setAll] = useState(false)
  if (!data || data.talkgroups.length === 0) {
    return (
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">
          P25 Talkgroup Activity
        </h2>
        <p className="text-xs text-on-surface-variant/60">No P25 call events in window.</p>
      </section>
    )
  }

  const max = Math.max(...data.talkgroups.map((t) => t.call_count), 1)
  const shown = all ? data.talkgroups : data.talkgroups.slice(0, TOP)

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">
        P25 Talkgroup Activity
        <span className="ml-2 text-on-surface-variant/60 normal-case tracking-normal">last {data.window_hours}h</span>
      </h2>
      <div className="stack-y-1.5">
        {shown.map((tg) => {
          const pct = Math.round((tg.call_count / max) * 100)
          return (
            <div key={tg.talkgroup_id} className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-on-surface-variant w-16 shrink-0 text-right">
                {tg.talkgroup_id}
              </span>
              <div className="flex-1 h-4 bg-black/40 border border-white/5 relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-violet-500/40"
                  style={{ width: `${pct}%` }}
                />
                <span className="absolute inset-0 flex items-center px-1.5 text-[11px] font-mono text-on-surface truncate">
                  {tg.label || `TGID ${tg.talkgroup_id}`}
                </span>
              </div>
              <span className="text-[11px] font-mono text-violet-400 w-8 text-right shrink-0">
                {tg.call_count}
              </span>
            </div>
          )
        })}
      </div>
      {data.talkgroups.length > TOP && (
        <button type="button" onClick={() => setAll((v) => !v)}
          className="mt-3 text-[11px] font-bold uppercase tracking-widest text-amber-gold hover:underline">
          {all ? `Show top ${TOP}` : `Show all ${data.talkgroups.length} talkgroups`}
        </button>
      )}
    </section>
  )
}
