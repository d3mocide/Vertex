import React from 'react'
import type { StorageData } from './types'

const SEV_COLOR: Record<string, string> = {
  critical: '#EF4444',
  emergency: '#EF4444',
  warning: '#F59E0B',
  info: '#374151',
}

function sevColor(s: string) {
  return SEV_COLOR[s.toLowerCase()] ?? '#374151'
}

function sevPill(s: string) {
  if (s === 'critical' || s === 'emergency') return 'text-red-400 border-red-500/40 bg-red-500/10'
  if (s === 'warning') return 'text-amber-400 border-amber-500/40 bg-amber-500/10'
  return 'text-gray-500 border-white/10 bg-white/5'
}

export function EventActivity({ storage }: { storage: StorageData | null }) {
  if (!storage) return null

  const types = Object.entries(storage.event_type_counts)

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-gray-500 mb-3">
        Event Activity
        <span className="ml-2 font-mono text-amber-400">{storage.event_count.toLocaleString()} total</span>
      </h2>
      <div className="border border-white/10 bg-black/30 p-3">
        {types.length === 0 ? (
          <p className="text-xs text-gray-500">No events recorded yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {types.map(([type, count]) => (
              <div key={type} className="flex items-center gap-2 border border-white/10 bg-black/20 px-2 py-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: sevColor(type.includes('emergency') || type.includes('critical') ? 'critical' : type.includes('warn') ? 'warning' : 'info') }}
                />
                <span className="text-[11px] font-mono text-gray-300">{type}</span>
                <span className="text-[11px] font-mono text-amber-400 font-bold">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
