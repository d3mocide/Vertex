import React from 'react'

/** Filled-area sparkline — pure SVG, no deps */
export function AreaSparkline({
  values,
  color = '#f59e0b',
  warn = false,
}: {
  values: number[]
  color?: string
  warn?: boolean
}) {
  if (values.length < 2)
    return <div className="h-10 opacity-30 text-[11px] text-center pt-3">No data</div>
  const c = warn ? '#f87171' : color
  const max = Math.max(...values, 0.001)
  const W = 200
  const H = 40
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - (v / max) * (H - 6) - 3
    return `${x},${y}`
  })
  const linePath = `M ${pts.join(' L ')}`
  const areaPath = `${linePath} L ${W},${H} L 0,${H} Z`
  const gradId = `sg-${Math.random().toString(36).slice(2, 7)}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.35" />
          <stop offset="100%" stopColor={c} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export function MetricCard({
  label,
  value,
  unit,
  warn = false,
  values,
  color,
}: {
  label: string
  value: number | null
  unit: string
  warn?: boolean
  values: number[]
  color?: string
}) {
  return (
    <div className="border border-white/10 bg-black/30 p-3 flex flex-col gap-1">
      <div className={`text-xl font-mono font-bold ${warn ? 'text-red-400' : 'text-amber-400'}`}>
        {value !== null ? `${value}${unit}` : '—'}
      </div>
      <div className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</div>
      <AreaSparkline values={values} warn={warn} color={color} />
    </div>
  )
}
