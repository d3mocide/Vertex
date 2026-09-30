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
  // What the table settles at for the chosen retention, at today's ingest rate and row size.
  const estimate = storage && storage.observation_count > 0 && storage.obs_per_day_7d > 0
    ? (() => {
        const rows = Math.round(storage.obs_per_day_7d * retentionDays)
        return { rows, bytes: rows * (storage.table_size_bytes / storage.observation_count) }
      })()
    : null
  const formatBytes = (b: number) => b >= 1_073_741_824 ? `${(b / 1_073_741_824).toFixed(1)} GB` : `${Math.round(b / 1_048_576)} MB`

  return (
    <section className="p-4 border border-white/10 bg-black/30 space-y-4">
      <h3 className="text-[11px] uppercase tracking-widest text-on-surface-variant">Data Retention Policy</h3>

        {/* Retention slider */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-on-surface-variant">Keep observations for</span>
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
          <div className="flex justify-between text-[11px] text-on-surface-variant/60">
            <span>1 day</span>
            <span>365 days</span>
          </div>
        </div>

        {estimate && (
          <div className="border-t border-white/10 pt-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-on-surface-variant uppercase tracking-widest">Settles at</span>
              <span className="font-mono text-sm font-bold text-on-surface">
                ≈ {estimate.rows.toLocaleString()} rows · {formatBytes(estimate.bytes)}
              </span>
            </div>
            <p className="text-[11px] text-on-surface-variant">
              At the current ingest rate. Older observations are removed daily, so storage levels off at this size instead of growing.
            </p>
          </div>
        )}

        <button
          onClick={onSave}
          disabled={saving}
          className="w-full py-2 text-[11px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 transition-colors disabled:opacity-50"
        >
          {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save Retention Policy'}
        </button>
      </div>
    </section>
  )
}
