import type { EntityActivityData } from './types'

/** One line: are the feeds that should be continuous delivering, and how much is active. */
export function DataQualitySummary({ activity }: { activity: EntityActivityData | null }) {
  if (!activity) return null
  const continuous = activity.types.filter((t) => t.continuous)
  const live = continuous.filter((t) => t.live).length
  const quiet = continuous.filter((t) => !t.live).map((t) => t.entity_type.replace(/_/g, ' '))
  const entities = activity.types.filter((t) => t.group !== 'dispatch')
  const activeNow = entities.reduce((s, t) => s + t.active_now, 0)
  const seen24 = entities.reduce((s, t) => s + t.seen_24h, 0)

  const healthy = continuous.length === 0 || live === continuous.length
  const degraded = live >= Math.ceil(continuous.length / 2)
  const color = healthy ? '#4ADE80' : degraded ? '#FCD34D' : '#FB923C'

  return (
    <section className="border border-white/10 bg-black/30 px-4 py-3 flex flex-wrap items-center gap-x-8 gap-y-2">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color }}>
          {healthy ? 'Feeds healthy' : degraded ? 'Feeds degraded' : 'Feeds poor'}
        </span>
      </div>
      <div className="text-[12px] font-mono text-on-surface-variant">
        <span className="text-on-surface font-bold">{live}/{continuous.length}</span> continuous feeds live
        {quiet.length > 0 && <span className="text-amber-gold"> · quiet: {quiet.join(', ')}</span>}
      </div>
      <div className="text-[12px] font-mono text-on-surface-variant">
        <span className="text-on-surface font-bold">{activeNow.toLocaleString()}</span> active now
        {' · '}<span className="text-on-surface font-bold">{seen24.toLocaleString()}</span> seen in 24 h
      </div>
    </section>
  )
}
