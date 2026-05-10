import React from 'react'
import type { MeshBatteryData } from './types'

function batteryColor(pct: number): string {
  if (pct >= 60) return 'bg-emerald-500/60'
  if (pct >= 30) return 'bg-amber-500/60'
  return 'bg-red-500/60'
}

function batteryText(pct: number): string {
  if (pct >= 60) return 'text-emerald-400'
  if (pct >= 30) return 'text-amber-400'
  return 'text-red-400'
}

export function MeshBatteryChart({ data }: { data: MeshBatteryData | null }) {
  if (!data || data.nodes.length === 0) {
    return (
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">
          Mesh Node Battery
        </h2>
        <p className="text-xs text-gray-600">No mesh nodes with battery data.</p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Mesh Node Battery</h2>
      <div className="space-y-1.5">
        {data.nodes.map((node) => (
          <div key={node.entity_id} className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-gray-400 w-24 shrink-0 truncate" title={node.label ?? node.entity_id}>
              {node.label ?? node.entity_id}
            </span>
            <div className="flex-1 h-4 bg-black/40 border border-white/5 relative overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${batteryColor(node.battery_level)}`}
                style={{ width: `${node.battery_level}%` }}
              />
            </div>
            <span className={`text-[10px] font-mono w-9 text-right shrink-0 ${batteryText(node.battery_level)}`}>
              {node.battery_level}%
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
