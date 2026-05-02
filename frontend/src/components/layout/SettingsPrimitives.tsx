export type MetricsData = {
  available: boolean
  req_rate: number
  error_pct: number
  memory_mb: number
  cpu_pct: number
  p95_ms: number
  history: Array<{ ts: number; req_rate: number; error_pct: number; memory_mb: number; p95_ms: number }>
}

export function MetricCard({ label, value, unit, icon, warn = false }: {
  label: string; value: string; unit: string; icon: string; warn?: boolean
}) {
  return (
    <div className="hud-panel p-2 text-center space-y-0.5">
      <span className={`ms text-[14px] leading-none ${warn ? 'text-red-emergency' : 'text-amber-gold'}`} aria-hidden="true">
        {icon}
      </span>
      <div className={`font-mono text-[13px] font-bold leading-tight ${warn ? 'text-red-emergency' : 'text-on-surface'}`}>
        {value}<span className="text-[9px] text-on-surface-variant ml-0.5">{unit}</span>
      </div>
      <div className="text-on-surface-variant uppercase tracking-wider text-[7px]">{label}</div>
    </div>
  )
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const w = 220
  const h = 28
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 4) - 2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} className="w-full overflow-visible" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="#FFB800" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function ToggleRow({ label, icon, checked, onChange }: {
  label: string
  icon: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const id = `setting-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <label htmlFor={id} className="flex items-center gap-3 cursor-pointer group">
      <span className={`ms text-[18px] leading-none transition-colors ${checked ? 'text-amber-gold' : 'text-on-surface-variant group-hover:text-on-surface'}`} aria-hidden="true">
        {icon}
      </span>
      <span className={`flex-1 font-bold text-[10px] tracking-widest uppercase transition-colors ${checked ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
        {label}
      </span>
      <div className="relative shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div className={`w-9 h-5 border transition-colors ${checked ? 'bg-amber-gold/20 border-amber-gold' : 'bg-surface-container border-outline-variant'}`} />
        <div className={`absolute top-0.5 h-4 w-4 border transition-all ${checked ? 'translate-x-4 bg-amber-gold border-amber-gold' : 'translate-x-0.5 bg-on-surface-variant border-on-surface-variant'}`} />
      </div>
    </label>
  )
}
