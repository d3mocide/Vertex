import type { StorageData } from './types'

function fmt(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(2)} GB`
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`
  return `${Math.max(1, Math.round(b / 1024))} KB`
}

/** Where the database space goes, by table. */
export function StorageBreakdown({ storage }: { storage: StorageData | null }) {
  const tables = storage?.table_sizes ?? []
  if (tables.length === 0) return null
  const total = tables.reduce((s, t) => s + t.bytes, 0)
  const max = Math.max(...tables.map((t) => t.bytes), 1)
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">
        Where the space goes
        <span className="ml-2 normal-case tracking-normal font-normal">largest tables · {fmt(total)}</span>
      </h2>
      <div className="border border-white/10 bg-black/30 divide-y divide-white/5">
        {tables.map((t) => (
          <div key={t.name} className="flex items-center gap-3 px-3 py-2">
            <span className="w-44 font-mono text-[12px] text-on-surface truncate">{t.name}</span>
            <div className="flex-1 h-1.5 bg-surface-container-highest">
              <div className="h-full bg-amber-gold/70" style={{ width: `${(t.bytes / max) * 100}%` }} />
            </div>
            <span className="w-20 text-right font-mono text-[12px] text-on-surface-variant">{fmt(t.bytes)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
