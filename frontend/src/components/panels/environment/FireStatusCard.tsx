import type { Entity } from '../../../store'

export type FireRelevance = 'local' | 'regional'

export type FirePanelEntity = {
  entity_id: string
  display_name: string
  distanceKm: number | null
  relevance: FireRelevance
  link?: string
  eventTs?: string
  state?: string
  provider?: string
  acres?: number
  containedPct?: number
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
    state: typeof entity.identity?.state === 'string' ? entity.identity.state.replace(/^US-/, '') : undefined,
    provider: typeof entity.identity?.provider === 'string' ? entity.identity.provider : undefined,
    acres: typeof entity.identity?.acres === 'number' ? entity.identity.acres : undefined,
    containedPct: typeof entity.identity?.contained_pct === 'number' ? entity.identity.contained_pct : undefined,
  }
}

export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return 'UPDATE TIME UNREPORTED'
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return 'UPDATE TIME UNREPORTED'

  const deltaMs = Date.now() - ts
  const hours = Math.max(0, Math.floor(deltaMs / 3_600_000))
  if (hours < 1) return 'UPDATED <1H AGO'
  if (hours < 24) return `UPDATED ${hours}H AGO`
  const days = Math.floor(hours / 24)
  return `UPDATED ${days}D AGO`
}

export function renderFireRow(fire: FirePanelEntity) {
  return (
    <article key={fire.entity_id} className="border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] lg:text-[12px] font-bold text-on-surface truncate">{fire.display_name}</div>
          <div className="mt-1 font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">
            {fire.state ?? 'State unreported'} · {fire.distanceKm != null ? `${Math.round(fire.distanceKm)} KM · ` : ''}{formatRelativeTime(fire.eventTs)}
          </div>
        </div>
        <span className={`font-mono text-[11px] font-bold uppercase tracking-widest ${fire.containedPct === 100 ? 'text-on-surface-variant' : 'text-amber-gold'}`}>
          {fire.relevance === 'local' ? 'NEARBY' : 'REGIONAL'}
        </span>
      </div>
      {(
        <div className="mt-1 font-mono text-[11px] text-on-surface-variant">
          {[fire.provider, fire.acres != null ? `${Math.round(fire.acres).toLocaleString()} acres` : undefined,
            fire.containedPct != null ? `${fire.containedPct}% contained` : 'Containment unreported'].filter(Boolean).join(' · ')}
        </div>
      )}
      {fire.link && /^https?:\/\//i.test(fire.link) && (
        <a
          href={fire.link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex text-[11px] font-mono uppercase tracking-widest text-amber-gold hover:text-amber-200"
        >
          SOURCE
        </a>
      )}
    </article>
  )
}
