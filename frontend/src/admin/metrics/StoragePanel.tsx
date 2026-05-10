import React from 'react'
import type { StorageData } from './types'

type Props = {
  storage: StorageData | null
  retentionDays: number
  setRetentionDays: (n: number) => void
  onSave: () => void
  saving: boolean
  saved: boolean
}

export function StoragePanel({ storage, retentionDays, setRetentionDays, onSave, saving, saved }: Props) {
  const daysUntilRetention = storage && storage.obs_per_day_7d > 0
    ? Math.max(0, Math.round(retentionDays - (storage.observation_count / storage.obs_per_day_7d)))
    : null

  return (
    <section className="p-4 border border-white/10 bg-black/30 space-y-4">
      <h3 className="text-[10px] uppercase tracking-widest text-gray-500">Data Retention Policy</h3>

        {/* Retention slider */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Keep observations for</span>
          <span className="font-mono text-amber-gold font-bold text-sm">{retentionDays}d</span>
        </div>

        <div className="space-y-1.5">
          <input
            type="range" min={1} max={365} step={1}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="w-full accent-amber-gold"
            aria-label="Retention days"
          />
          <div className="flex justify-between text-[9px] text-gray-600">
            <span>1 day</span>
            <span>365 days</span>
          </div>
        </div>

        {daysUntilRetention !== null && (
          <div className="flex items-center justify-between border-t border-white/10 pt-3">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest">At current ingestion rate</span>
            <span className={`font-mono text-sm font-bold ${daysUntilRetention < 3 ? 'text-red-emergency' : daysUntilRetention < 7 ? 'text-amber-gold' : 'text-emerald-300'}`}>
              {daysUntilRetention}d until purge
            </span>
          </div>
        )}

        <button
          onClick={onSave}
          disabled={saving}
          className="w-full py-2 text-[10px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 transition-colors disabled:opacity-50"
        >
          {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save Retention Policy'}
        </button>
      </div>
    </section>
  )
}
