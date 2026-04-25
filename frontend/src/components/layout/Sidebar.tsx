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
  const { alerts, news, health, entities, connected, cameras, weather } = useCivicStore()

  const aircraft  = Object.values(entities).filter((e) => e.entity_type === 'aircraft').length
  const vessels   = Object.values(entities).filter((e) => e.entity_type === 'vessel').length
  const meshNodes = Object.values(entities).filter((e) => e.entity_type === 'mesh_node').length
  const cams      = cameras.length
  const wAlerts   = weather.alerts.length
  const activeInc = alerts.length

  // Derive incidents from alerts (first 4)
  const incidents = alerts.slice(0, 4)

  // News items from store, fallback to empty
  // News items filtered for Regional News only
  const newsItems = news
    .filter(item => item.category === 'Regional News')
    .sort((a, b) => {
      const bTs = Date.parse(b.published || '') || 0
      const aTs = Date.parse(a.published || '') || 0
      return bTs - aTs
    })

  return (
    <aside
      className="w-80 h-full sidebar-panel flex flex-col shrink-0 z-30"
      aria-label="Vertex sidebar"
    >
      {/* Brand header */}
      <div className="h-16 flex items-center px-6 border-b border-white/5 bg-onyx-deep/40 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative h-8 w-8 flex-shrink-0">
            <svg viewBox="0 0 32 32" className="h-full w-full fill-none stroke-amber-gold stroke-[2]" aria-hidden="true">
              {/* Tactical Viewfinder / Crosshair */}
              <path d="M4 12 V6 H12" />
              <path d="M20 6 H28 V12" />
              <path d="M28 20 V26 H20" />
              <path d="M12 26 H4 V20" />
              {/* Central Observation Point */}
              <circle cx="16" cy="16" r="3" className="fill-amber-gold stroke-none" />
              {/* Axis markers */}
              <path d="M16 8 V11" className="opacity-40" />
              <path d="M16 21 V24" className="opacity-40" />
              <path d="M8 16 H11" className="opacity-40" />
              <path d="M21 16 H24" className="opacity-40" />
            </svg>
          </div>
          
          <div className="flex items-baseline leading-none">
            <span className="text-[18px] font-black tracking-[0.05em] text-white uppercase select-none">
              VERTEX
            </span>
          </div>
        </div>
      </div>

      {/* Grid status */}
      <div className="p-4 border-b border-amber-gold-muted bg-onyx-deep/60 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <span className="label-caps">GRID STATUS</span>
          <div className="flex items-center gap-1.5">
            <span
              className={`ms text-[14px] ${health.ok ? 'text-amber-gold' : 'text-red-emergency'}`}
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              monitor_heart
            </span>
            <span
              className={`ml-1 w-2 h-2 rounded-full ${connected ? 'bg-green-ais animate-pulse' : 'bg-red-emergency shadow-[0_0_8px_rgba(255,59,48,0.5)]'}`}
              title={connected ? 'WebSocket connected' : 'Disconnected'}
            />
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <GridStatusDots ok={health.ok} />
            <div className="flex flex-col">
              <span className={`font-mono text-[12px] uppercase tracking-tighter ${health.ok ? 'text-amber-gold' : 'text-red-emergency font-bold'}`}>
                {health.ok ? 'Nominal' : 'Degraded'}
              </span>
              {!health.ok && (
                <span className="text-[9px] text-red-emergency/80 uppercase font-mono tracking-tight">
                  Check service logs
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
             <span className={`flex items-center text-[10px] font-mono ${activeInc > 0 ? 'text-red-emergency animate-pulse' : 'text-on-surface-variant opacity-20'}`} title="Active Incidents">
               <span className="ms text-[14px] mr-1" aria-hidden="true">warning</span>
               {activeInc}
             </span>
             <span className={`flex items-center text-[10px] font-mono ${wAlerts > 0 ? 'text-amber-gold' : 'text-on-surface-variant opacity-20'}`} title="Weather Alerts">
               <span className="ms text-[14px] mr-1" aria-hidden="true">cloud_alert</span>
               {wAlerts}
             </span>
          </div>
        </div>

        {/* Entity count strip */}
        <div className="flex flex-col gap-2.5 text-[10px] font-mono border-t border-white/5 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-4">
              <span className="text-cyan-adsb flex items-center" title="Aircraft (ADS-B)">
                <span className="ms text-[14px] mr-1" aria-hidden="true">flight</span>
                {aircraft}
              </span>
              <span className="text-green-ais flex items-center" title="Vessels (AIS)">
                <span className="ms text-[14px] mr-1" aria-hidden="true">directions_boat</span>
                {vessels}
              </span>
            </div>
            <div className="flex gap-4">
              <span className="text-amber-gold flex items-center" title="Traffic Cameras">
                <span className="ms text-[14px] mr-1" aria-hidden="true">videocam</span>
                {cams}
              </span>
              {meshNodes > 0 && (
                <span className="text-amber-p25 flex items-center" title="Mesh Nodes">
                  <span className="ms text-[14px] mr-1" aria-hidden="true">router</span>
                  {meshNodes}
                </span>
              )}
            </div>
                </div>
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
                  time={formatIncidentTime(alert.published)}
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
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return '—'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}hr ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatIncidentTime(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return '—'
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })
}
