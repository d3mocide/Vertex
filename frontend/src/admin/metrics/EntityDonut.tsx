import React from 'react'
import type { StorageData } from './types'

const TYPE_COLORS: Record<string, string> = {
  // From VERTEX Atlas Icons design guide
  aircraft: '#00BFFF',       // cat-air (ADS-B)
  vessel: '#00C853',         // cat-sea (AIS)
  aprs: '#B388FF',           // cat-aprs (APRS packet)
  p25: '#FF8F00',            // cat-mesh (P25 radio)
  mesh_node: '#FF8F00',      // cat-mesh
  meshcore: '#FF8F00',       // cat-mesh
  stream_gauge: '#4FC3F7',   // cat-stream (hydro)
  lightning: '#FFE94D',      // cat-lightning (high-vis yellow)
  fire_incident: '#FF5252',  // cat-fire
  fire: '#FF5252',           // cat-fire
  ground: '#B388FF',         // cat-aprs (ground stations)
  seismic: '#4FC3F7',        // cat-stream (hydro-adjacent)
  weather: '#4FC3F7',        // cat-stream (water/weather)
  traffic: '#00C853',        // cat-sea (nominal)
  news_article: '#FFB800',   // amber-gold (info)
  alert: '#C62828',          // cat-emerg (alerts)
  satellite: '#B388FF',      // cat-aprs (misc)
}
const FALLBACK = '#8C8C8C'  // on-surface-variant

function getColor(type: string) {
  return TYPE_COLORS[type.toLowerCase()] ?? FALLBACK
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const x1 = cx + r * Math.cos(toRad(startAngle - 90))
  const y1 = cy + r * Math.sin(toRad(startAngle - 90))
  const x2 = cx + r * Math.cos(toRad(endAngle - 90))
  const y2 = cy + r * Math.sin(toRad(endAngle - 90))
  const large = endAngle - startAngle > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

export function EntityDonut({ storage }: { storage: StorageData | null }) {
  if (!storage) return null

  const entries = Object.entries(storage.entity_type_counts)
  const total = entries.reduce((s, [, v]) => s + v, 0)

  let angle = 0
  const slices = entries.map(([type, count]) => {
    const sweep = total > 0 ? (count / total) * 360 : 0
    const start = angle
    angle += sweep
    return { type, count, start, sweep }
  })

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-gray-500 mb-3">Entity Breakdown</h2>
      <div className="flex flex-wrap gap-8 items-center">
        {/* Donut */}
        <svg width="160" height="160" viewBox="0 0 160 160">
          {slices.map((s) => {
            const color = getColor(s.type)
            if (s.sweep < 1) return null
            return (
              <path
                key={s.type}
                d={describeArc(80, 80, 60, s.start, s.start + s.sweep - 0.5)}
                fill="none"
                stroke={color}
                strokeWidth="20"
                strokeLinecap="butt"
              />
            )
          })}
          <circle cx="80" cy="80" r="40" fill="#0a0a0f" />
          <text x="80" y="77" textAnchor="middle" className="fill-amber-400 font-mono text-sm" fill="#f59e0b" fontFamily="Roboto Mono, monospace">
            {total.toLocaleString()}
          </text>
          <text x="80" y="93" textAnchor="middle" fontSize="9" fill="#6B7280" fontFamily="Roboto Mono, monospace">
            ENTITIES
          </text>
        </svg>
        {/* Count cards */}
        <div className="grid grid-cols-3 gap-2 flex-1 min-w-[300px]">
          {entries.map(([type, count]) => (
            <div key={type} className="border border-white/10 bg-black/30 p-2 min-w-[80px]">
              <div className="text-base font-mono font-bold" style={{ color: getColor(type) }}>
                {count.toLocaleString()}
              </div>
              <div className="text-[11px] text-gray-500 uppercase tracking-wider">{type}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
