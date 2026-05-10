import React from 'react'
import type { TalkgroupActivityData } from './types'

export function TalkgroupActivity({ data }: { data: TalkgroupActivityData | null }) {
  if (!data || data.talkgroups.length === 0) {
    return (
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">
          P25 Talkgroup Activity
        </h2>
        <p className="text-xs text-gray-600">No P25 call events in window.</p>
      </section>
    )
  }

  const max = Math.max(...data.talkgroups.map((t) => t.call_count), 1)

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">
        P25 Talkgroup Activity
        <span className="ml-2 text-gray-600 normal-case tracking-normal">last {data.window_hours}h</span>
      </h2>
      <div className="space-y-1.5">
        {data.talkgroups.map((tg) => {
          const pct = Math.round((tg.call_count / max) * 100)
          return (
            <div key={tg.talkgroup_id} className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-gray-400 w-16 shrink-0 text-right">
                {tg.talkgroup_id}
              </span>
              <div className="flex-1 h-4 bg-black/40 border border-white/5 relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-violet-500/40"
                  style={{ width: `${pct}%` }}
                />
                <span className="absolute inset-0 flex items-center px-1.5 text-[9px] font-mono text-gray-300 truncate">
                  {tg.label || `TGID ${tg.talkgroup_id}`}
                </span>
              </div>
              <span className="text-[10px] font-mono text-violet-400 w-8 text-right shrink-0">
                {tg.call_count}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
