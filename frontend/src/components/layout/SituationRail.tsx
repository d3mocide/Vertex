import { useEffect, useState } from 'react'
import { useCivicPick } from '../../store'
import type { Advisory, NavTab, RadioIncident } from '../../storeTypes'
import { CATEGORY } from '../panels/RadioIncidents'
import { isMajorTrafficIncident } from '../../incidentUtils'

/*
 * The desktop sidebar's situation rail: what matters now (the ranked
 * advisory feed), what dispatch is working near home in the last hour, and
 * the top local headlines. Replaces a traffic-only incident list and a raw
 * RSS dump.
 */

const NEARBY_WINDOW_MS = 60 * 60 * 1000
const SIDELINED = new Set(['Sports', 'Obituaries'])

function ago(iso: string | null | undefined, now: number): string {
  const ts = Date.parse(iso ?? '')
  if (Number.isNaN(ts)) return ''
  const mins = Math.max(0, Math.floor((now - ts) / 60_000))
  return mins < 1 ? 'now' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`
}

function RailSection({ title, icon, aside, children }: { title: string; icon: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className="ms text-[16px] text-amber-gold leading-none" aria-hidden="true">{icon}</span>
        <h3 className="section-heading !mb-0">{title}</h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

type RailPart = 'now' | 'nearby' | 'headlines'

export function SituationRail({ parts = ['now', 'nearby', 'headlines'] }: { parts?: RailPart[] }) {
  const { advisories, radioIncidents, trafficIncidents, news, setActiveTab, setFocusIncidentId } =
    useCivicPick('advisories', 'radioIncidents', 'trafficIncidents', 'news', 'setActiveTab', 'setFocusIncidentId')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const openAdvisory = (a: Advisory) => {
    if (a.target.incident) setFocusIncidentId(a.target.incident)
    setActiveTab(a.target.tab as NavTab)
  }
  const openIncident = (i: RadioIncident) => {
    setFocusIncidentId(i.id)
    setActiveTab('incidents')
  }

  // Now
  const items = advisories?.items ?? []
  const level = advisories?.level ?? 'green'

  // Nearby, last hour: dispatch near home, plus road closures. A zone extends
  // "near" to a neighbouring city, but only within twice the radius (some
  // zones are huge: Portland, rivers, airports) — same rule as advisories.py.
  const nearbyKm = radioIncidents?.nearby_km ?? 8
  const nearby = (radioIncidents?.incidents ?? []).filter((i) =>
    now - Date.parse(i.last_seen) < NEARBY_WINDOW_MS
    && i.status !== 'cleared'
    && i.dist_km != null
    && (i.dist_km <= nearbyKm || (i.dist_km <= 2 * nearbyKm && i.geofences.length > 0)))
  const byCategory = new Map<string, number>()
  for (const i of nearby) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + 1)
  const closures = trafficIncidents.filter(isMajorTrafficIncident).length

  // Top local headlines
  const headlines = news
    .filter((n) => (n.local ?? 0) >= 2 && !SIDELINED.has(n.topic ?? '') && n.category !== 'Tactical Resources')
    .slice(0, 3)

  return (
    <div className="space-y-6">
      {parts.includes('now') && <RailSection
        title="Now"
        icon={level === 'red' ? 'emergency_home' : level === 'amber' ? 'warning' : 'check_circle'}
        aside={items.length > 0 && <span className="font-mono text-[11px] text-on-surface-variant">{advisories?.count}</span>}
      >
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-[12px] text-green-ais">
            <span className="w-1.5 h-1.5 rounded-full bg-green-ais" aria-hidden="true" />
            All clear — no advisories near you.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.slice(0, 3).map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => openAdvisory(a)}
                        className={`w-full text-left p-2.5 border transition-colors hover:border-amber-gold/60 ${a.level === 'red'
                          ? 'border-red-emergency/60 bg-red-emergency/10' : 'border-amber-gold/30 bg-amber-gold/5'}`}>
                  <span className="flex items-start gap-2">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${a.level === 'red' ? 'bg-red-emergency' : 'bg-amber-gold'}`} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-[12px] font-bold text-on-surface leading-snug">{a.title}</span>
                      {a.detail && <span className="block font-mono text-[11px] text-on-surface-variant mt-0.5 line-clamp-2">{a.detail}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </RailSection>}

      {parts.includes('nearby') && <RailSection
        title="Nearby · last hour"
        icon="radar"
        aside={<button type="button" onClick={() => setActiveTab('incidents')} className="font-mono text-[11px] text-on-surface-variant hover:text-amber-gold">MAP →</button>}
      >
        {nearby.length === 0 && closures === 0 ? (
          <p className="text-[12px] text-on-surface-variant">Nothing dispatched within {Math.round(nearbyKm / 1.609)} mi in the last hour.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
                <span key={cat} className="inline-flex items-center gap-1 font-mono text-[11px] text-on-surface border border-white/10 px-1.5 py-0.5">
                  <span className="ms text-[13px] text-on-surface-variant" aria-hidden="true">{CATEGORY[cat as keyof typeof CATEGORY]?.icon ?? 'radio'}</span>
                  {n} {CATEGORY[cat as keyof typeof CATEGORY]?.label ?? cat}
                </span>
              ))}
              {closures > 0 && (
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-on-surface border border-white/10 px-1.5 py-0.5">
                  <span className="ms text-[13px] text-on-surface-variant" aria-hidden="true">traffic</span>
                  {closures} road {closures === 1 ? 'impact' : 'impacts'}
                </span>
              )}
            </div>
            <ul className="divide-y divide-white/5">
              {[...nearby].sort((a, b) => b.severity - a.severity || Date.parse(b.last_seen) - Date.parse(a.last_seen)).slice(0, 4).map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => openIncident(i)} className="w-full flex items-center gap-2 py-1.5 text-left hover:text-amber-gold">
                    <span className={`ms text-[15px] shrink-0 ${i.severity >= 5 ? 'text-red-emergency' : i.severity >= 3 ? 'text-amber-gold' : 'text-on-surface-variant'}`} aria-hidden="true">
                      {CATEGORY[i.category]?.icon ?? 'radio'}
                    </span>
                    <span className="flex-1 min-w-0 text-[12px] text-on-surface truncate">
                      {i.nature ?? CATEGORY[i.category]?.label}{i.location ? ` · ${i.location}` : ''}{i.city ? `, ${i.city}` : ''}
                    </span>
                    <span className="font-mono text-[11px] text-on-surface-variant shrink-0">{ago(i.last_seen, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </RailSection>}

      {parts.includes('headlines') && <RailSection
        title="Local headlines"
        icon="newspaper"
        aside={<button type="button" onClick={() => setActiveTab('intel')} className="font-mono text-[11px] text-on-surface-variant hover:text-amber-gold">INTEL →</button>}
      >
        {headlines.length === 0 ? (
          <p className="text-[12px] text-on-surface-variant">No local stories right now.</p>
        ) : (
          <ul className="space-y-2.5">
            {headlines.map((n) => (
              <li key={n.id ?? n.link}>
                <a href={n.link} target="_blank" rel="noreferrer noopener" className="block group">
                  <span className="block text-[12px] text-on-surface leading-snug group-hover:text-amber-gold">
                    {n.emergency && <span className="ms ms-fill text-[13px] text-amber-gold align-[-2px] mr-1" aria-hidden="true">priority_high</span>}
                    {n.title}
                  </span>
                  <span className="block font-mono text-[10px] uppercase tracking-widest text-on-surface-variant mt-0.5">
                    {n.source.replace(/_/g, ' ')}{(n.sources?.length ?? 1) > 1 ? ` +${(n.sources?.length ?? 1) - 1}` : ''} · {ago(n.published, now)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </RailSection>}
    </div>
  )
}
