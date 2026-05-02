import type { Entity } from '../../../store'

export type FireRelevance = 'local' | 'regional'

export type FirePanelEntity = {
  entity_id: string
  display_name: string
  distanceKm: number | null
  relevance: FireRelevance
  link?: string
  eventTs?: string
}

export function firePanelEntityFromEntity(entity: Entity): FirePanelEntity | null {
  if (entity.entity_type !== 'fire_incident') return null

  const relevance = entity.identity?.relevance
  if (relevance !== 'local' && relevance !== 'regional') return null

  const distanceRaw = entity.identity?.distance_km ?? entity.distance_km
  const eventTs = typeof entity.identity?.event_ts === 'string'
    ? entity.identity.event_ts
    : typeof entity.last_seen === 'string'
      ? entity.last_seen
      : undefined

  return {
    entity_id: entity.entity_id,
    display_name: entity.display_name || 'Wildfire',
    distanceKm: typeof distanceRaw === 'number' ? distanceRaw : null,
    relevance,
    link: typeof entity.identity?.link === 'string' ? entity.identity.link : undefined,
    eventTs,
  }
}

export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return 'OPEN INCIDENT'
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return 'OPEN INCIDENT'

  const deltaMs = Date.now() - ts
  const hours = Math.max(0, Math.floor(deltaMs / 3_600_000))
  if (hours < 1) return 'UPDATED <1H AGO'
  if (hours < 24) return `UPDATED ${hours}H AGO`
  const days = Math.floor(hours / 24)
  return `UPDATED ${days}D AGO`
}

function renderFireRow(fire: FirePanelEntity) {
  return (
    <article key={fire.entity_id} className="border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold text-on-surface truncate">{fire.display_name}</div>
          <div className="mt-1 font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">
            {fire.distanceKm != null ? `${Math.round(fire.distanceKm)} KM · ` : ''}{formatRelativeTime(fire.eventTs)}
          </div>
        </div>
        <span className={`font-mono text-[8px] font-bold uppercase tracking-widest ${fire.relevance === 'local' ? 'text-red-500' : 'text-amber-gold'}`}>
          {fire.relevance === 'local' ? 'ALERT' : 'WATCH'}
        </span>
      </div>
      {fire.link && (
        <a
          href={fire.link}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex text-[8px] font-mono uppercase tracking-widest text-amber-gold hover:text-amber-200"
        >
          SOURCE
        </a>
      )}
    </article>
  )
}

export function FireStatusCard({
  localFires,
  regionalFires,
  aqi,
  aqiLabel,
}: {
  localFires: FirePanelEntity[]
  regionalFires: FirePanelEntity[]
  aqi: number | undefined
  aqiLabel: string | undefined
}) {
  const smokeRisk =
    aqi == null ? 'AQI TELEMETRY LIMITED' :
    aqi <= 50 ? 'LOW LOCAL SMOKE IMPACT' :
    aqi <= 100 ? 'WATCH FOR DRIFTING SMOKE' :
    'SMOKE IMPACT POSSIBLE'

  const smokeTone =
    aqi == null ? 'text-on-surface-variant' :
    aqi <= 50 ? 'text-green-ais' :
    aqi <= 100 ? 'text-amber-gold' :
    'text-red-500'

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40 relative overflow-hidden">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">local_fire_department</span>
        FIRE / SMOKE STATUS
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="border border-red-500/20 bg-red-500/5 px-3 py-2">
          <div className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest">Alert Radius</div>
          <div className="mt-1 text-[20px] font-black text-on-surface">{localFires.length}</div>
          <div className="font-mono text-[8px] text-red-400 uppercase tracking-widest">Local fires</div>
        </div>
        <div className="border border-amber-gold/20 bg-amber-gold/5 px-3 py-2">
          <div className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest">Regional Watch</div>
          <div className="mt-1 text-[20px] font-black text-on-surface">{regionalFires.length}</div>
          <div className="font-mono text-[8px] text-amber-gold uppercase tracking-widest">Potential sources</div>
        </div>
        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
          <div className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest">Smoke Signal</div>
          <div className={`mt-1 text-[10px] font-black uppercase tracking-wider ${smokeTone}`}>{smokeRisk}</div>
          <div className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">
            {aqi != null ? `AQI ${aqi}${aqiLabel ? ` · ${aqiLabel}` : ''}` : 'Use smoke overlay + AQI'}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <section aria-labelledby="fire-local-heading">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="fire-local-heading" className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">Local Alert Queue</h3>
            <span className="font-mono text-[8px] text-red-400 uppercase tracking-widest">Actionable near region</span>
          </div>
          {localFires.length === 0 ? (
            <div className="border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">
              No current fires inside the local alert radius.
            </div>
          ) : (
            <div className="space-y-1.5">
              {localFires.slice(0, 3).map(renderFireRow)}
            </div>
          )}
        </section>

        <section aria-labelledby="fire-regional-heading">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="fire-regional-heading" className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">Regional Smoke Watch</h3>
            <span className="font-mono text-[8px] text-amber-gold uppercase tracking-widest">Use for drift awareness</span>
          </div>
          {regionalFires.length === 0 ? (
            <div className="border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">
              No regional wildfire sources currently inside the watch area.
            </div>
          ) : (
            <div className="space-y-1.5">
              {regionalFires.slice(0, 4).map(renderFireRow)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
