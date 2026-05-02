export function AqiGauge({ aqi }: { aqi: number | undefined }) {
  if (aqi == null) return null
  const pct = Math.min(aqi / 300, 1) * 100
  const color =
    aqi <= 50  ? '#00C853' :
    aqi <= 100 ? '#FFB800' :
    aqi <= 150 ? '#FF8F00' : '#C62828'

  const label =
    aqi <= 50  ? 'Good' :
    aqi <= 100 ? 'Moderate' :
    aqi <= 150 ? 'Unhealthy (Sensitive)' : 'Unhealthy'

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40 relative overflow-hidden group">
      <div
        className="absolute -right-8 -top-8 w-24 h-24 blur-[40px] opacity-15 pointer-events-none transition-colors duration-1000"
        style={{ backgroundColor: color }}
      />

      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">air</span>
        AIR QUALITY
      </div>

      <div className="flex items-center gap-5 mb-4">
        <span className="font-mono text-5xl font-black tracking-tighter drop-shadow-sm leading-none" style={{ color }}>
          {aqi}
        </span>
        <div className="flex flex-col">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
          <span className="text-[8px] text-on-surface-variant uppercase tracking-tighter">Current EPA Rating</span>
        </div>
      </div>

      <div className="relative h-2 w-full bg-white/5 rounded-full overflow-hidden">
        <div className="absolute inset-0 flex">
          <div className="h-full w-[16.6%] bg-green-500/20" />
          <div className="h-full w-[16.6%] bg-yellow-500/20" />
          <div className="h-full w-[16.6%] bg-orange-500/20" />
          <div className="h-full w-[16.6%] bg-red-500/20" />
          <div className="h-full w-[16.6%] bg-purple-500/20" />
          <div className="h-full w-[16.6%] bg-red-900/20" />
        </div>
        <div
          className="absolute left-0 top-0 bottom-0 transition-all duration-1000 ease-out rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>

      <div className="flex justify-between mt-2 font-mono text-[7px] text-on-surface-variant/50 uppercase tracking-tighter">
        <span>0 Good</span>
        <span>100 Mod</span>
        <span>200 Unhealthy</span>
        <span>300+</span>
      </div>
    </div>
  )
}
