import type { ReactNode } from 'react'
import type { OverviewData } from './types'

type Tone = 'good' | 'warn' | 'bad' | 'muted'
const TONE_TEXT: Record<Tone, string> = { good: 'text-green-ais', warn: 'text-amber-gold', bad: 'text-red-emergency', muted: 'text-on-surface-variant' }
const TONE_DOT: Record<Tone, string> = { good: 'bg-green-ais', warn: 'bg-amber-gold', bad: 'bg-red-emergency', muted: 'bg-on-surface-variant' }

function Card({ title, tone, headline, children }: { title: string; tone: Tone; headline: ReactNode; children?: ReactNode }) {
  return (
    <div className="border border-white/10 bg-black/30 p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />
        <span className="text-[11px] uppercase tracking-widest text-on-surface-variant truncate">{title}</span>
      </div>
      <div className={`font-mono text-xl font-bold ${TONE_TEXT[tone]}`}>{headline}</div>
      {children && <div className="stack-y-0.5 text-[11px] text-on-surface-variant font-mono">{children}</div>}
    </div>
  )
}

const Line = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex flex-wrap justify-between gap-x-2"><span>{label}</span><span className="text-on-surface text-right">{value}</span></div>
)

function bytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`
  if (b >= 1_048_576) return `${Math.round(b / 1_048_576)} MB`
  return `${Math.round(b / 1024)} KB`
}
function ago(s: number): string {
  if (s < 90) return `${Math.round(s)} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(1)} h`
}
function uptime(s?: number): string {
  if (!s) return '—'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** The moving parts of the install, one card each, with the numbers that matter for that part. */
export function ServiceCards({ overview }: { overview: OverviewData | null }) {
  if (!overview) return null
  const { postgres: pg, redis: rd, api, pollers, briefing, receiver } = overview.services
  const late = overview.feeds.filter((f) => f.status === 'stale' || f.status === 'down').length

  const pgPing = pg.ping_ms ?? -1
  const rdPing = rd.ping_ms ?? -1
  const redisUse = rd.max_memory_bytes && rd.used_memory_bytes ? rd.used_memory_bytes / rd.max_memory_bytes : null

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Card title="PostgreSQL" tone={pgPing < 0 ? 'bad' : pgPing > 100 ? 'warn' : 'good'}
        headline={pgPing < 0 ? 'down' : `${pgPing} ms`}>
        {pg.size_bytes !== undefined && <Line label="database" value={bytes(pg.size_bytes)} />}
        {pg.connections !== undefined && <Line label="connections" value={`${pg.connections} / ${pg.max_connections}`} />}
      </Card>

      <Card title="Redis" tone={rdPing < 0 ? 'bad' : rdPing > 50 ? 'warn' : 'good'}
        headline={rdPing < 0 ? 'down' : `${rdPing} ms`}>
        {rd.used_memory_bytes !== undefined && (
          <Line label="memory" value={`${bytes(rd.used_memory_bytes)}${rd.max_memory_bytes ? ` / ${bytes(rd.max_memory_bytes)}` : ''}`} />
        )}
        {redisUse !== null && redisUse > 0.8 && <div className="text-amber-gold">memory limit close</div>}
        {rd.clients !== undefined && <Line label="clients · keys" value={`${rd.clients} · ${rd.keys}`} />}
      </Card>

      <Card title="API" tone={!api ? 'muted' : api.error_pct > 5 || api.p95_ms > 1000 ? 'bad' : api.error_pct > 2 || api.p95_ms > 500 ? 'warn' : 'good'}
        headline={api ? `${api.req_rate.toFixed(1)} req/s` : '—'}>
        {api ? (
          <>
            <Line label="p95 latency" value={`${Math.round(api.p95_ms)} ms`} />
            <Line label="errors" value={`${api.error_pct.toFixed(1)}%`} />
            <Line label="cpu · memory" value={`${Math.round(api.cpu_pct)}% · ${Math.round(api.memory_mb)} MB`} />
            <Line label="viewers · uptime" value={`${api.ws_clients} · ${uptime(api.uptime_seconds)}`} />
          </>
        ) : <div>collecting baseline…</div>}
      </Card>

      <Card title="Pollers" tone={pollers.error || pollers.stale || late ? 'warn' : 'good'} headline={`${pollers.ok} / ${pollers.total}`}>
        <Line label="stale · errors" value={`${pollers.stale} · ${pollers.error}`} />
        {pollers.slowest && <Line label="quietest" value={`${pollers.slowest.name} (${ago(pollers.slowest.staleness_s)})`} />}
        <Line label="data sources" value={late ? `${late} late` : `${overview.feeds.length} on schedule`} />
      </Card>

      <Card title="AI briefing" tone={!briefing ? 'muted' : briefing.age_s > 3 * 3600 ? 'warn' : 'good'}
        headline={briefing ? (briefing.posture ?? '—') : 'none'}>
        {briefing && (
          <>
            <Line label="generated" value={`${ago(briefing.age_s)} ago`} />
            {briefing.duration_s ? <Line label="took" value={`${Math.round(briefing.duration_s)} s`} /> : null}
            {briefing.model && <div className="truncate" title={briefing.model}>{briefing.model.replace(/^.*\//, '')}</div>}
          </>
        )}
      </Card>

      <Card title="ADS-B receiver"
        tone={!receiver ? 'muted' : receiver.beast_connected === false ? 'muted' : receiver.beast_healthy === false ? 'warn' : 'good'}
        headline={!receiver ? '—' : receiver.beast_connected === false ? 'not connected' : receiver.beast_healthy === false ? 'silent' : 'connected'}>
        {receiver && receiver.beast_connected !== false && (
          <>
            {receiver.last_frame_age_s !== null && <Line label="last frame" value={`${receiver.last_frame_age_s.toFixed(1)} s ago`} />}
            {receiver.count !== null && <Line label="aircraft" value={`${receiver.count} (${receiver.positioned ?? 0} positioned)`} />}
            {!!receiver.frames_dropped && <Line label="frames dropped" value={receiver.frames_dropped} />}
          </>
        )}
        {receiver && receiver.beast_connected === false && <div>community &amp; OpenSky feeds cover aircraft</div>}
      </Card>
    </div>
  )
}
