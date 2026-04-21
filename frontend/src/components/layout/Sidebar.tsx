import { useCivicStore } from '../../store'

function GridStatusDots({ ok }: { ok: boolean }) {
  return (
    <div className="flex gap-2">
      <div className={`w-2.5 h-2.5 rounded-full border ${ok ? 'border-amber-gold-muted opacity-20' : 'border-red-emergency opacity-60'}`} />
      <div className={`w-2.5 h-2.5 rounded-full border ${ok ? 'border-amber-gold-muted opacity-20' : 'border-amber-gold-muted opacity-20'}`} />
      <div className={`w-2.5 h-2.5 rounded-full ${ok ? 'bg-amber-gold shadow-gold-sm' : 'bg-red-emergency'}`} />
    </div>
  )
}

function IncidentCard({
  id,
  time,
  title,
  severity,
}: {
  id: string
  time: string
  title: string
  severity: 'high' | 'low'
}) {
  const isHigh = severity === 'high'
  return (
    <div
      className="incident-card"
      role="listitem"
      tabIndex={0}
      aria-label={`Incident ${id}: ${title}`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span
            className="ms text-[14px] leading-none"
            aria-hidden="true"
            style={{ fontVariationSettings: "'FILL' 0" }}
          >
            {isHigh ? 'warning' : 'info'}
          </span>
          <span className={`font-mono text-[11px] ${isHigh ? 'text-amber-gold' : 'text-on-surface-variant'}`}>
            {id}
          </span>
        </div>
        <span className="font-mono text-[10px] text-on-surface-variant">{time}</span>
      </div>
      <p className="text-[12px] text-on-surface leading-tight">{title}</p>
    </div>
  )
}

function NewsRow({ source, age, title }: { source: string; age: string; title: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-0.5 bg-amber-gold shrink-0" aria-hidden="true" />
      <div>
        <span className="font-mono text-[9px] text-on-surface-variant block mb-1 uppercase tracking-tighter">
          {source} • {age}
        </span>
        <p className="text-[11px] text-on-surface hover:text-amber-gold cursor-pointer transition-colors leading-relaxed">
          {title}
        </p>
      </div>
    </div>
  )
}

export function Sidebar() {
  const { alerts, news, health, entities, connected } = useCivicStore()

  const aircraft  = Object.values(entities).filter((e) => e.entity_type === 'aircraft').length
  const vessels   = Object.values(entities).filter((e) => e.entity_type === 'vessel').length
  const meshNodes = Object.values(entities).filter((e) => e.entity_type === 'mesh_node').length

  // Derive incidents from alerts (first 4)
  const incidents = alerts.slice(0, 4)

  // News items from store, fallback to empty
  const newsItems = news.slice(0, 5)

  return (
    <aside
      className="w-80 h-full sidebar-panel flex flex-col shrink-0 z-30"
      aria-label="Civic Grid sidebar"
    >
      {/* Brand header */}
      <div className="h-14 flex items-center px-6 border-b border-white/5 bg-[#050505]/60 backdrop-blur-2xl shrink-0">
        <span className="text-amber-gold font-black tracking-[0.25em] text-lg uppercase select-none">
          CIVIC GRID
        </span>
      </div>

      {/* Grid status */}
      <div className="p-4 border-b border-amber-gold-muted bg-onyx-deep/60 shrink-0">
        <span className="label-caps block mb-3">GRID STATUS</span>
        <div className="flex items-center gap-4 mb-3">
          <GridStatusDots ok={health.ok} />
          <span className="font-mono text-[12px] text-amber-gold uppercase tracking-tighter">
            {health.ok ? 'Nominal' : 'Degraded'}
          </span>
          <span
            className={`ml-auto w-2 h-2 rounded-full ${connected ? 'bg-green-ais animate-pulse' : 'bg-on-surface-variant'}`}
            title={connected ? 'WebSocket connected' : 'Disconnected'}
            aria-label={connected ? 'Live data connected' : 'Disconnected'}
          />
        </div>

        {/* Entity count strip */}
        <div className="flex gap-4 text-[10px] font-mono">
          <span className="text-cyan-adsb">
            <span className="ms text-[12px] mr-1" aria-hidden="true">flight</span>
            {aircraft}
          </span>
          <span className="text-green-ais">
            <span className="ms text-[12px] mr-1" aria-hidden="true">directions_boat</span>
            {vessels}
          </span>
          {meshNodes > 0 && (
            <span className="text-amber-p25">
              <span className="ms text-[12px] mr-1" aria-hidden="true">router</span>
              {meshNodes}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-onyx-black">

        {/* Active incidents */}
        <section aria-labelledby="incidents-heading">
          <h3 id="incidents-heading" className="section-heading">
            <span className="w-1 h-1 bg-amber-gold shrink-0" aria-hidden="true" />
            Active Incidents
            {incidents.length > 0 && (
              <span className="ml-auto font-mono text-[9px] bg-amber-gold text-onyx-black px-1.5 py-0.5 font-bold">
                {incidents.length}
              </span>
            )}
          </h3>

          {incidents.length === 0 ? (
            <p className="text-[11px] text-on-surface-variant italic">No active incidents.</p>
          ) : (
            <div className="space-y-3" role="list">
              {incidents.map((alert, i) => (
                <IncidentCard
                  key={i}
                  id={`INC-${String(i + 1).padStart(4, '0')}`}
                  time={new Date(alert.published).toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
                  })}
                  title={alert.title}
                  severity={i === 0 ? 'high' : 'low'}
                />
              ))}
            </div>
          )}
        </section>

        {/* News feed */}
        <section className="pt-4 border-t border-amber-gold-muted/30" aria-labelledby="news-heading">
          <h3 id="news-heading" className="section-heading">
            <span className="w-1 h-1 bg-on-surface-variant shrink-0" aria-hidden="true" />
            News Feed
          </h3>

          {newsItems.length === 0 ? (
            <>
              {/* Placeholder rows so the sidebar isn't empty on first load */}
              <div className="space-y-4">
                <NewsRow
                  source="LOCAL GOV"
                  age="—"
                  title="Awaiting feed data…"
                />
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {newsItems.map((item, i) => (
                <NewsRow
                  key={i}
                  source={item.source.toUpperCase()}
                  age={formatAge(item.published)}
                  title={item.title}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}

function formatAge(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  const mins = Math.floor(diff / 60_000)
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}hr ago`
  return `${Math.floor(hrs / 24)}d ago`
}
