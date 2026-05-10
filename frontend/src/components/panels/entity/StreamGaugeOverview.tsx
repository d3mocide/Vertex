import type { OverviewProps } from './AircraftOverview'

const ACTION_STAGES: Record<string, string> = {
  action:    'text-red-400',
  flood:     'text-orange-400',
  bankfull:  'text-amber-400',
  normal:    'text-emerald-400',
}

function stageColor(stage: string | undefined): string {
  if (!stage) return 'text-on-surface'
  const lower = stage.toLowerCase()
  for (const [key, cls] of Object.entries(ACTION_STAGES)) {
    if (lower.includes(key)) return cls
  }
  return 'text-on-surface'
}

export function StreamGaugeOverview({ entity, getIdentity }: OverviewProps) {
  const ident = entity.identity ?? {}
  const heightFt = typeof ident.gauge_height_ft === 'number' ? (ident.gauge_height_ft as number) : null
  const flowCfs  = typeof ident.flow_cfs === 'number' ? (ident.flow_cfs as number) : null
  const siteName = getIdentity('site_name') ?? getIdentity('name') ?? entity.display_name
  const siteNo   = getIdentity('site_no') ?? getIdentity('gauge_id')
  const stageStr = getIdentity('flood_stage') ?? getIdentity('action_stage') ?? getIdentity('stage')

  const formatFlow = (cfs: number) =>
    cfs >= 10000
      ? `${(cfs / 1000).toFixed(1)}k cfs`
      : `${Math.round(cfs).toLocaleString()} cfs`

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/5 border border-white/10 p-2 rounded-sm relative overflow-hidden">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant">
            <span className="ms text-[12px]">water</span>
            <span className="label-caps text-[8px]">Stage Height</span>
          </div>
          <div className="font-mono text-sky-400 text-[14px] truncate">
            {heightFt != null ? `${heightFt.toFixed(2)} ft` : '--'}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 p-2 rounded-sm">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant">
            <span className="ms text-[12px]">water_pump</span>
            <span className="label-caps text-[8px]">Discharge</span>
          </div>
          <div className={`font-mono text-[14px] truncate ${flowCfs != null ? 'text-cyan-300' : 'text-on-surface-variant'}`}>
            {flowCfs != null ? formatFlow(flowCfs) : '--'}
          </div>
        </div>
      </div>

      <div className="space-y-3 mt-3">
        <div>
          <span className="label-caps text-[9px] text-amber-gold-dim mb-1 block">Station</span>
          <div className="space-y-1">
            {siteName && (
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-[9px] text-on-surface-variant">Name</span>
                <span className="font-mono text-[10px] text-on-surface truncate" title={siteName}>{siteName}</span>
              </div>
            )}
            {siteNo && (
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-[9px] text-on-surface-variant">Site No.</span>
                <span className="font-mono text-[10px] text-on-surface">{siteNo}</span>
              </div>
            )}
            {stageStr && (
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-[9px] text-on-surface-variant">Flood Stage</span>
                <span className={`font-mono text-[10px] ${stageColor(stageStr)}`}>{stageStr}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-[9px] text-on-surface-variant">Distance</span>
              <span className="font-mono text-[10px] text-on-surface">
                {entity.distance_km != null ? `${entity.distance_km.toFixed(1)} km` : '--'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-white/10">
          <div className="flex items-center gap-1 text-on-surface-variant">
            <span className="ms text-[10px]">schedule</span>
            <span className="text-[9px] uppercase tracking-wider">Last Updated</span>
          </div>
          <span className="font-mono text-[10px] text-amber-gold">
            {entity.last_seen
              ? new Date(entity.last_seen).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : '--'}
          </span>
        </div>
      </div>
    </>
  )
}
