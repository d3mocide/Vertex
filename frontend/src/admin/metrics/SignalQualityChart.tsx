import type { SignalQualityData } from './types'

/**
 * Receiver-reported signal strength, for the sources that report one. Only positions from your own
 * receiver carry it; community and OpenSky aircraft do not, so this is about the local ADS-B receiver.
 */
export function SignalQualityChart({ data }: { data: SignalQualityData | null }) {
  const types = data?.types ?? []
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">
        Receiver signal
        <span className="ml-2 normal-case tracking-normal font-normal">last {data?.window_minutes ?? 60} min</span>
      </h2>
      {types.length === 0 ? (
        <div className="border border-white/10 bg-black/30 p-3 text-[12px] text-on-surface-variant">
          No signal readings in this window (needs a local receiver).
        </div>
      ) : (
        <div className="border border-white/10 bg-black/30 divide-y divide-white/5">
          {types.map((t) => (
            <div key={t.entity_type} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-3 py-2 text-[12px] font-mono">
              <span className="text-on-surface capitalize w-28">{t.entity_type.replace(/_/g, ' ')}</span>
              <span className="text-on-surface-variant">avg <span className="text-on-surface font-bold">{t.avg_quality?.toFixed(1)}</span></span>
              <span className="text-on-surface-variant">median <span className="text-on-surface">{t.median_quality?.toFixed(1)}</span></span>
              <span className="text-on-surface-variant">range {t.min_quality?.toFixed(1)} – {t.max_quality?.toFixed(1)}</span>
              <span className="text-on-surface-variant ml-auto">{t.sample_count.toLocaleString()} readings</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
