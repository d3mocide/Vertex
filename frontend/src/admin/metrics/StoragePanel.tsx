import React from 'react'
import type { StorageData } from './types'

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

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
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Storage &amp; Retention</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Growth stats */}
        <div className="border border-white/10 bg-black/30 p-4 space-y-3">
          <h3 className="text-[9px] uppercase tracking-widest text-gray-600">Database Size</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-lg font-mono font-bold text-amber-400">
                {storage ? storage.observation_count.toLocaleString() : '—'}
              </div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider">Observations</div>
            </div>
            <div>
              <div className="text-lg font-mono font-bold text-gray-300">
                {storage ? formatBytes(storage.table_size_bytes) : '—'}
              </div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider">Table Size</div>
            </div>
            <div>
              <div className="text-lg font-mono font-bold text-gray-300">
                {storage ? `~${Math.round(storage.obs_per_day_7d).toLocaleString()}` : '—'}
              </div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider">Obs / Day (7d avg)</div>
            </div>
            <div>
              <div className={`text-lg font-mono font-bold ${daysUntilRetention !== null && daysUntilRetention < 5 ? 'text-amber-400' : 'text-gray-300'}`}>
                {daysUntilRetention !== null ? `~${daysUntilRetention}d` : '—'}
              </div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider">Until Purge</div>
            </div>
          </div>
        </div>

        {/* Retention slider */}
        <div className="border border-white/10 bg-black/30 p-4 space-y-3">
          <h3 className="text-[9px] uppercase tracking-widest text-gray-600">Data Retention Policy</h3>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Keep observations for</span>
            <span className="font-mono text-amber-400 text-sm">{retentionDays}d</span>
          </div>
          <input
            type="range" min={1} max={365} step={1}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="w-full accent-amber-500"
            aria-label="Retention days"
          />
          <div className="flex justify-between text-[9px] text-gray-600">
            <span>1d</span><span>365d</span>
          </div>
          <button
            onClick={onSave}
            disabled={saving}
            className="w-full py-1.5 text-[10px] font-bold uppercase tracking-widest border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 transition-colors disabled:opacity-50"
          >
            {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save Retention Policy'}
          </button>
        </div>
      </div>
    </section>
  )
}
