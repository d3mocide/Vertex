import type { SignalQualityData } from './types'

const ENTITY_COLORS: Record<string, string> = {
  aircraft:      '#00BFFF',      // cat-air (ADS-B)
  vessel:        '#00C853',      // cat-sea (AIS)
  mesh_node:     '#FF8F00',      // cat-mesh
  aprs_position: '#B388FF',      // cat-aprs
  p25:           '#FF8F00',      // cat-mesh (P25 radio)

}

function barColor(type: string) {
  return ENTITY_COLORS[type] ?? '#6B7280'
}

export function SignalQualityChart({ data }: { data: SignalQualityData | null }) {
  if (!data || data.types.length === 0) {
    return (
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-gray-500 mb-3">Signal Quality</h2>
        <div className="border border-white/10 bg-black/30 p-4">
          <div className="text-center space-y-2">
            <div className="text-[11px] text-on-surface-variant">
              No signal quality data in the last {data?.window_minutes ?? 60} min
            </div>
            <div className="text-[11px] text-gray-600">
              Not all sources report signal quality (RSSI, SNR, heading accuracy). 
              <br />Currently available for: ADS-B, AIS, P25.
            </div>
          </div>
        </div>
      </section>
    )
  }

  const maxAvg = Math.max(...data.types.map(t => t.avg_quality ?? 0), 1)

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-gray-500 mb-3">
        Signal Quality
        <span className="ml-2 text-on-surface-variant normal-case tracking-normal font-normal">
          (last {data.window_minutes} min · avg / range per type)
        </span>
      </h2>
      <div className="border border-white/10 bg-black/30 p-4 space-y-3">
        {data.types.map((entry) => {
          const avg = entry.avg_quality ?? 0
          const barPct = maxAvg > 0 ? (avg / maxAvg) * 100 : 0
          const color = barColor(entry.entity_type)
          return (
            <div key={entry.entity_type} className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px] text-on-surface capitalize">
                  {entry.entity_type.replace(/_/g, ' ')}
                </span>
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] text-on-surface-variant">
                    {entry.min_quality?.toFixed(1)} – {entry.max_quality?.toFixed(1)}
                  </span>
                  <span className="font-mono text-[11px] font-bold" style={{ color }}>
                    {avg.toFixed(1)}
                  </span>
                  <span className="text-[11px] text-on-surface-variant">
                    n={entry.sample_count.toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="h-1.5 bg-gray-800 overflow-hidden">
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.8 }}
                />
              </div>
            </div>
          )
        })}
        <p className="text-[11px] text-on-surface-variant pt-1 border-t border-white/10">
          Signal quality is a normalized 0–100 field. Not all entity types report it.
        </p>
      </div>
    </section>
  )
}
