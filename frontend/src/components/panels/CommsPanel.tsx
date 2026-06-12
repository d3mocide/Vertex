import { useState, useMemo } from 'react'
import { useCivicStore, MeshMessage, Entity, SystemEvent, Track, MeshLink } from '../../store'
import { getDistanceMeters } from '../../layers/geoUtils'
import { DEFAULT_CENTER } from '../../config'
import { MeshFleetPanel } from './MeshFleetPanel'

function formatTime(iso: string) {
  if (!iso) return '--:--'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '--:--'
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '--:--'
  }
}

function prettyConversationLabel(conversationKey: string, channelName?: string): string {
  const raw = (channelName || conversationKey || 'public').trim()
  if (!raw) return 'Public'
  if (/^(public|general)$/i.test(raw)) return 'Public'
  if (/^[a-f0-9]{12,}$/i.test(raw)) return `Channel ${raw.slice(0, 8)}`
  return raw
}

function NodeRow({ node, distM }: { node: Entity; distM: number }) {
  const km = (distM / 1000).toFixed(1)
  const isMesh = node.entity_type === 'mesh_node'

  return (
    <div className="flex items-center justify-between p-1.5 px-3 hover:bg-white/10 transition-colors group">
      <div className="flex items-center gap-2.5">
        <span className={`ms text-[14px] ${isMesh ? 'text-amber-p25' : 'text-violet-space'} opacity-80`}>
          {isMesh ? 'hub' : 'sensors'}
        </span>
        <div className="flex flex-col -space-y-0.5">
          <span className="text-[11px] font-bold text-on-surface group-hover:text-amber-gold transition-colors truncate max-w-[120px]">
            {node.display_name || node.entity_id.split(':').pop()}
          </span>
          <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest opacity-60">
            {node.source}
          </span>
        </div>
      </div>
      <div className="text-right">
        <span className="font-mono text-[11px] text-amber-gold font-bold">{km} KM</span>
      </div>
    </div>
  )
}

function TransmissionRow({ event }: { event: SystemEvent }) {
  const isStart = event.event_type === 'p25_call_start'
  const isTranscript = event.event_type === 'p25_transcript'
  const transcriptText = event.details?.transcript as string | undefined

  return (
    <div className="flex items-start justify-between p-2 px-3 border-b border-white/5 hover:bg-white/5 transition-colors gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <span className={`ms text-[14px] mt-0.5 ${isStart ? 'text-green-ais' : isTranscript ? 'text-amber-gold' : 'text-on-surface-variant'} opacity-70`}>
          {isStart ? 'podcasts' : isTranscript ? 'chat_bubble' : 'stop_circle'}
        </span>
        <div className="flex flex-col min-w-0">
          <span className="text-[11px] font-bold text-on-surface uppercase tracking-tight truncate">
            {event.summary}
          </span>
          {isTranscript && transcriptText ? (
            <span className="text-[11px] text-on-surface-variant italic leading-snug mt-0.5 line-clamp-2">
              "{transcriptText}"
            </span>
          ) : (
            <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">
              {isStart ? 'Call Start' : 'Call End'}
            </span>
          )}
        </div>
      </div>
      <span className="font-mono text-[11px] text-on-surface-variant shrink-0 whitespace-nowrap mt-0.5">
        {new Date(event.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  )
}

function AircraftRow({ track, distM }: { track: Track; distM: number }) {
  const km = (distM / 1000).toFixed(1)
  return (
    <div className="flex items-center justify-between p-2 px-3 border-b border-white/5 hover:bg-white/5 transition-colors group">
      <div className="flex items-center gap-3">
        <span className="ms text-[14px] text-cyan-ais opacity-80">flight</span>
        <div className="flex flex-col">
          <span className="text-[11px] font-bold text-on-surface group-hover:text-amber-gold transition-colors">
            {track.callsign || track.uid.toUpperCase()}
          </span>
          <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">
            {track.category || 'Aircraft'} • {Math.round(track.altMeters * 3.28084)} FT
          </span>
        </div>
      </div>
      <span className="font-mono text-[11px] text-amber-gold">{km} KM</span>
    </div>
  )
}

function Sparkline({ data, max, color }: { data: number[]; max: number; color: string }) {
  if (data.length < 2) return <div className="h-4 w-12 bg-white/5 animate-pulse rounded-sm" />

  const width = 60
  const height = 16
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - (Math.min(max, val) / max) * height
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        className="transition-all duration-500"
      />
    </svg>
  )
}

function SignalMeter({ label, value, max, colorClass, history }: { label: string; value: number; max: number; colorClass: string; history?: number[] }) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100))
  const hexColor = colorClass === 'text-amber-gold' ? '#FFB800' : '#00E5FF'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-end px-1">
        <div className="flex flex-col">
          <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest leading-none mb-1">{label}</span>
          <span className={`font-mono text-[11px] font-black ${colorClass} leading-none`}>{value.toFixed(1)}</span>
        </div>
        {history && <Sparkline data={history} max={max} color={hexColor} />}
      </div>
      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
        <div
          className={`h-full transition-all duration-1000 ${colorClass.replace('text-', 'bg-')}`}
          style={{ width: `${percent}%`, boxShadow: `0 0 10px ${percent > 50 ? `${hexColor}4D` : 'transparent'}` }}
        />
      </div>
    </div>
  )
}

function formatAge(iso: string | undefined): string {
  if (!iso) return '—'
  const ageSec = (Date.now() - new Date(iso).getTime()) / 1000
  if (ageSec < 120) return 'just now'
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`
  return `${Math.floor(ageSec / 3600)}h ago`
}

function SpectralMonitor({ links, history, status }: { links: MeshLink[]; history: Record<string, { snr: number[], quality: number[] }>; status: any }) {
  const { radio, entities } = useCivicStore()

  // Calculate top 3 links by SNR
  const topLinks = useMemo(() => {
    return [...links].sort((a, b) => (b.snr || 0) - (a.snr || 0)).slice(0, 3)
  }, [links])

  // OP25 Connection State
  const op25Online = useMemo(() => {
    if (!radio.updated) return false
    const elapsed = Date.now() - new Date(radio.updated).getTime()
    return elapsed < 10000 // Connected if updated in the last 10 seconds
  }, [radio.updated])

  // APRS Nodes State
  const aprsStations = useMemo(() => {
    return Object.values(entities).filter(e => e.entity_type === 'aprs')
  }, [entities])

  const mostRecentAprs = useMemo(() => {
    if (aprsStations.length === 0) return null
    return [...aprsStations].sort((a, b) => {
      const timeA = a.last_seen ? new Date(a.last_seen).getTime() : 0
      const timeB = b.last_seen ? new Date(b.last_seen).getTime() : 0
      return timeB - timeA
    })[0]
  }, [aprsStations])

  const aprsActive = useMemo(() => {
    if (!mostRecentAprs?.last_seen) return false
    const elapsed = Date.now() - new Date(mostRecentAprs.last_seen).getTime()
    return elapsed < 3600000 * 12 // Active if heard within last 12 hours
  }, [mostRecentAprs])

  return (
    <div className="grid grid-cols-1 gap-4 mt-2">
      {/* ── OP25 Receiver Monitor ── */}
      <div className="p-3 border border-white/10 bg-white/5 rounded-sm flex flex-col gap-3 transition-colors hover:bg-white/10 group">
        <div className="flex items-center justify-between border-b border-white/5 pb-2">
          <div className="flex items-center gap-2">
            <span className="ms text-[14px] text-amber-gold">
              radio
            </span>
            <span className="font-bold text-[11px] text-on-surface uppercase truncate">
              OP25 Trunked Link
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${op25Online ? 'bg-green-ais animate-pulse shadow-[0_0_8px_rgba(50,229,144,0.5)]' : 'bg-red-emergency'}`} />
            <span className="text-[11px] font-mono text-on-surface-variant uppercase">
              {op25Online ? 'Connected' : 'Offline'}
            </span>
          </div>
        </div>

        <div className="space-y-3 font-mono text-[10px]">
          {op25Online ? (
            <>
              {radio.freq_hz != null && (
                <div className="flex justify-between items-center px-1">
                  <span className="text-on-surface-variant uppercase">Freq</span>
                  <span className="text-[11px] font-bold text-on-surface">
                    {(radio.freq_hz / 1_000_000).toFixed(4)} MHz
                  </span>
                </div>
              )}
              <div className="flex justify-between items-start gap-2 px-1">
                <span className="text-on-surface-variant uppercase shrink-0">State</span>
                <span className="text-right text-[11px] font-bold text-amber-gold uppercase truncate max-w-[170px]" title={radio.state === 'call' && radio.tgid ? `TGID ${radio.tgid} (${radio.tag || ''})` : ''}>
                  {radio.state === 'call' && radio.tgid
                    ? `Call: TGID ${radio.tgid} (${radio.tag || 'Unknown'})`
                    : radio.state === 'encrypted'
                      ? 'Encrypted Voice'
                      : 'Scanning Channels'}
                </span>
              </div>
              {radio.state === 'call' && radio.priority != null && (
                <div className="flex justify-between items-center px-1">
                  <span className="text-on-surface-variant uppercase">Scan Priority</span>
                  <span className="text-[11px] font-bold text-green-ais">
                    LEVEL {radio.priority}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="py-1 px-1 text-on-surface-variant/40 uppercase tracking-wider text-[9px] italic">
              Waiting for tuner metadata...
            </div>
          )}
        </div>
      </div>

      {/* ── APRS Receiver Monitor ── */}
      <div className="p-3 border border-white/10 bg-white/5 rounded-sm flex flex-col gap-3 transition-colors hover:bg-white/10 group">
        <div className="flex items-center justify-between border-b border-white/5 pb-2">
          <div className="flex items-center gap-2">
            <span className="ms text-[14px] text-amber-gold">
              sensors
            </span>
            <span className="font-bold text-[11px] text-on-surface uppercase truncate">
              APRS Gateway
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${aprsActive ? 'bg-cyan-ais animate-pulse shadow-[0_0_8px_rgba(0,229,255,0.5)]' : 'bg-white/20'}`} />
            <span className="text-[11px] font-mono text-on-surface-variant uppercase">
              {aprsActive ? 'Rx Active' : 'Standby'}
            </span>
          </div>
        </div>

        <div className="space-y-3 font-mono text-[10px]">
          <div className="flex justify-between items-center px-1">
            <span className="text-on-surface-variant uppercase">IGate Stations</span>
            <span className="text-[11px] font-bold text-on-surface">
              {aprsStations.length} Decoded
            </span>
          </div>

          {mostRecentAprs ? (
            <>
              <div className="flex justify-between items-start gap-2 px-1">
                <span className="text-on-surface-variant uppercase shrink-0">Last Station</span>
                <span className="text-right text-[11px] font-bold text-cyan-ais truncate max-w-[150px]" title={mostRecentAprs.display_name}>
                  {mostRecentAprs.display_name || mostRecentAprs.entity_id.split(':').pop()}
                </span>
              </div>
              <div className="flex justify-between items-center px-1">
                <span className="text-on-surface-variant uppercase">Last Contact</span>
                <span className="text-[11px] font-bold text-on-surface">
                  {formatAge(mostRecentAprs.last_seen)}
                </span>
              </div>
            </>
          ) : (
            <div className="py-1 px-1 text-on-surface-variant/40 uppercase tracking-wider text-[9px] italic">
              No APRS packets decoded...
            </div>
          )}
        </div>
      </div>

      {/* ── Local Device Card ── */}
      {status && (
        <div className="p-3 border border-white/10 bg-white/5 rounded-sm flex flex-col gap-3 transition-colors hover:bg-white/10 group">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div className="flex items-center gap-2">
              <span className="ms text-[14px] text-amber-gold">hub</span>
              <span className="font-bold text-[11px] text-on-surface uppercase truncate">
                Mesh Monitor
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${status.connected ? 'bg-green-ais animate-pulse shadow-[0_0_8px_rgba(50,229,144,0.5)]' : 'bg-red-emergency'}`} />
              <span className="text-[11px] font-mono text-on-surface-variant uppercase">{status.connected ? 'Online' : 'Offline'}</span>
            </div>
          </div>
          <div className="space-y-4">
            {status.battery_level != null && (
              <SignalMeter label="Battery" value={status.battery_level} max={100} colorClass={status.battery_level > 20 ? 'text-green-ais' : 'text-red-emergency'} />
            )}
            {status.voltage != null && (
              <div className="flex justify-between items-center px-1">
                <span className="font-mono text-[11px] text-on-surface-variant uppercase">Voltage</span>
                <span className="font-mono text-[12px] font-bold text-on-surface">{typeof status.voltage === 'number' ? status.voltage.toFixed(2) : status.voltage}V</span>
              </div>
            )}
            <div className="text-[11px] font-mono text-on-surface-variant/60 uppercase truncate">
              {status.url}
            </div>
          </div>
        </div>
      )}

      {/* ── Top P2P Mesh Links ── */}
      {topLinks.map((link, i) => {
        const key = `${link.node_a}-${link.node_b}`
        const h = history[key] || { snr: [link.snr || 0], quality: [link.link_quality || 0] }

        return (
          <div key={`${link.node_a}-${link.node_b}-${i}`} className="p-3 border border-white/10 bg-white/5 rounded-sm flex flex-col gap-3 hover:bg-white/10 transition-colors group">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <div className="flex items-center gap-2">
                <span className="ms text-[14px] text-amber-gold group-hover:scale-110 transition-transform">hub</span>
                <span className="font-bold text-[11px] text-on-surface uppercase truncate max-w-[150px]">
                  {link.node_b.split(':').pop()}
                </span>
              </div>
              <span className="text-[11px] font-mono text-on-surface-variant uppercase bg-white/5 px-1.5 rounded-full">P2P Link</span>
            </div>
            <div className="space-y-4">
              <SignalMeter label="SNR (dB)" value={link.snr || 0} max={20} colorClass="text-amber-gold" history={h.snr} />
              <SignalMeter label="Link Quality" value={link.link_quality || 0} max={100} colorClass="text-cyan-ais" history={h.quality} />
            </div>
          </div>
        )
      })}

      {topLinks.length === 0 && !status?.connected && !op25Online && !aprsActive && (
        <div className="col-span-3 py-10 border border-dashed border-white/10 rounded-sm flex flex-col items-center justify-center opacity-30">
          <span className="ms text-3xl mb-2 animate-pulse">signal_cellular_connected_no_internet_4_bar</span>
          <span className="text-[11px] uppercase font-mono tracking-[0.2em]">Searching for active RF links...</span>
        </div>
      )}
    </div>
  )
}

export function CommsPanel() {
  const { radio, meshMessages, entities, systemEvents, tracks, meshLinks, linkHistory, meshStatus } = useCivicStore()
  const [msgFilter, setMsgFilter] = useState('')
  const [selectedConv, setSelectedConv] = useState<string>('all')
  const [activeTab, setActiveTab] = useState<'chat' | 'fleet' | 'p25'>('chat')

  // Calculate nearest nodes
  const nearestNodes = useMemo(() => {
    const list = Object.values(entities).filter(e =>
      (e.entity_type === 'mesh_node' || e.entity_type === 'aprs') &&
      e.lat != null && e.lon != null
    )

    return list.map(e => ({
      entity: e,
      dist: getDistanceMeters(DEFAULT_CENTER[1], DEFAULT_CENTER[0], e.lat!, e.lon!)
    })).sort((a, b) => a.dist - b.dist).slice(0, 10)
  }, [entities])

  // Nearest aircraft (ADS-B monitoring)
  const nearestAircraft = useMemo(() => {
    return Object.values(tracks)
      .filter(t => t.type === 'air')
      .map(t => ({
        track: t,
        dist: getDistanceMeters(DEFAULT_CENTER[1], DEFAULT_CENTER[0], t.lat, t.lon)
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5)
  }, [tracks])

  const p25Events = useMemo(() => {
    return systemEvents.filter(ev =>
      ev.event_type === 'p25_call_start' ||
      ev.event_type === 'p25_call_end' ||
      ev.event_type === 'p25_transcript'
    ).reverse().slice(0, 8)
  }, [systemEvents])

  const p25EventsLog = useMemo(() => {
    return systemEvents.filter(ev =>
      ev.event_type === 'p25_call_start' ||
      ev.event_type === 'p25_call_end' ||
      ev.event_type === 'p25_transcript'
    ).reverse().slice(0, 30)
  }, [systemEvents])

  const conversationNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const m of meshMessages) {
      const key = m.conversation_key || 'general'
      const name = m.channel_name?.trim()
      if (!name) continue
      names.set(key, name)
    }
    return names
  }, [meshMessages])

  // Unique conversation keys sorted by most recent message.
  const conversations = useMemo(() => {
    const latest = new Map<string, number>()
    for (const m of meshMessages) {
      const key = m.conversation_key || 'general'
      const ts = new Date(m.timestamp || 0).getTime()
      if (!latest.has(key) || ts > latest.get(key)!) latest.set(key, ts)
    }
    return [...latest.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => ({
        key,
        label: prettyConversationLabel(key, conversationNames.get(key)),
      }))
  }, [meshMessages, conversationNames])

  // Messages to display: filtered by text search + selected conversation,
  // then grouped by conversation_key for the "all" view.
  const messageGroups = useMemo(() => {
    const q = msgFilter.toLowerCase()
    const base = meshMessages.filter(m => {
      if (selectedConv !== 'all' && (m.conversation_key || 'general') !== selectedConv) return false
      if (!q) return true
      return (
        (m.text ?? '').toLowerCase().includes(q) ||
        (m.sender_name ?? '').toLowerCase().includes(q) ||
        (m.conversation_key ?? '').toLowerCase().includes(q) ||
        (m.channel_name ?? '').toLowerCase().includes(q)
      )
    })

    if (selectedConv !== 'all') {
      return [{ key: selectedConv, msgs: [...base].sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()) }]
    }

    // Group by conversation, sort groups by most recent message DESC.
    const groupMap = new Map<string, MeshMessage[]>()
    for (const m of base) {
      const key = m.conversation_key || 'general'
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(m)
    }
    return [...groupMap.entries()]
      .sort((a, b) => {
        const latestA = Math.max(...a[1].map(m => new Date(m.timestamp || 0).getTime()))
        const latestB = Math.max(...b[1].map(m => new Date(m.timestamp || 0).getTime()))
        return latestB - latestA
      })
      .map(([key, msgs]) => ({
        key,
        msgs: [...msgs].sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()),
      }))
  }, [meshMessages, msgFilter, selectedConv])

  return (
    <div className="relative w-full h-full z-10 flex flex-col overflow-hidden bg-onyx-black/20 backdrop-blur-md">
      {/* Header */}
      <div className="px-4 py-3 border-b border-amber-gold-muted flex items-center gap-3 shrink-0">
        <span className="ms text-[18px] text-amber-gold leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>
          forum
        </span>
        <h2 className="font-bold text-sm uppercase tracking-tight text-on-surface">
          Comms
        </h2>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-ais animate-pulse" />
          <span className="font-mono text-[11px] text-green-ais uppercase tracking-widest">ACTIVE</span>
        </div>
      </div>
      {/* ── Body: Split pane layout ── */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden bg-onyx-black/5">
        {/* ── Left Column: Radio & Topology ── */}
        <div className="w-full lg:w-[420px] shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r border-white/10 bg-onyx-black/10 lg:h-full lg:overflow-y-auto p-4 lg:p-6 gap-6 pb-4 lg:pb-36 custom-scrollbar">
          {/* RF Communications Card */}
          <section>
            <h3 className="section-heading mb-3 flex items-center gap-2">
              <span className="ms text-[14px] text-amber-gold">radio</span>
              RF Monitoring
            </h3>
            <div className="p-4 border border-amber-gold/30 bg-amber-gold/5 glass-panel">
              {radio.state === 'call' || radio.state === 'encrypted' ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-mono text-[11px] text-amber-gold uppercase tracking-[0.2em] mb-1">LIVE TALKGROUP</div>
                      <div className="text-lg font-black text-on-surface uppercase leading-tight">
                        {radio.tag || `TG ${radio.tgid}`}
                      </div>
                    </div>
                    <div className={`
                      px-2 py-0.5 text-[11px] font-black uppercase
                      ${radio.state === 'encrypted' ? 'bg-red-emergency text-white' : 'bg-amber-gold text-onyx-black'}
                    `}>
                      {radio.state === 'encrypted' ? 'SECURE' : 'RX'}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 border-t border-white/5 pt-3">
                    <div className="flex-1">
                      <div className="text-[11px] text-on-surface-variant uppercase font-mono">Frequency</div>
                      <div className="text-xs font-mono">{(radio.freq_hz! / 1_000_000).toFixed(4)} MHz</div>
                    </div>
                    <div className="w-px h-6 bg-white/5" />
                    <div className="flex-1">
                      <div className="text-[11px] text-on-surface-variant uppercase font-mono">TGID</div>
                      <div className="text-xs font-mono">{radio.tgid}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center py-4 text-on-surface-variant/40">
                  <span className="ms text-3xl mb-2 animate-pulse">settings_input_antenna</span>
                  <span className="text-[11px] uppercase tracking-widest font-mono">Scanning P25 Network...</span>
                </div>
              )}
            </div>
          </section>

          {/* Topology / Proximity */}
          <section>
            <h3 className="section-heading mb-3 flex items-center gap-2">
              <span className="ms text-[14px] text-amber-gold">hub</span>
              Topology Proximity
            </h3>
            <div className="border border-white/10 bg-white/5">
              <div className="bg-white/5 px-3 py-1.5 border-b border-white/5">
                <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">
                  Nearest Nodes (Mesh / APRS / GS)
                </span>
              </div>
              {nearestNodes.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2">
                  {nearestNodes.map(({ entity, dist }) => (
                    <div key={entity.entity_id} className="border-b border-white/5 sm:odd:border-r">
                      <NodeRow node={entity} distM={dist} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-on-surface-variant text-[11px] uppercase font-mono opacity-50">
                  No topological nodes in range
                </div>
              )}
            </div>
          </section>

          {/* Spectral Health */}
          <section>
            <h3 className="section-heading mb-3 flex items-center gap-2">
              <span className="ms text-[14px] text-amber-gold">analytics</span>
              Spectral Health
            </h3>
            <SpectralMonitor links={meshLinks} history={linkHistory} status={meshStatus} />
          </section>
        </div>

        {/* ── Right Column: Tabbed View (Mesh Messages, Mesh Fleet, P25 Radio Log) ── */}
        <div className="flex-1 min-w-0 flex flex-col lg:h-full p-4 lg:p-6 gap-6 pb-28 lg:pb-6">
          {/* ── Tab Switcher Header ── */}
          <div className="flex border border-white/10 bg-white/5 rounded-sm p-1 gap-1 shrink-0 select-none">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-1.5 md:py-2 px-2 md:px-3 rounded-sm font-mono text-[10px] md:text-[11px] font-bold uppercase tracking-wider md:tracking-widest flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 transition-all ${activeTab === 'chat'
                ? 'bg-amber-gold text-onyx-black shadow-[0_0_8px_rgba(255,184,0,0.3)]'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
                }`}
            >
              <span className="ms text-[14px]">chat</span>
              <span><span className="hidden sm:inline">Mesh </span>Chat</span>
            </button>
            <button
              onClick={() => setActiveTab('fleet')}
              className={`flex-1 py-1.5 md:py-2 px-2 md:px-3 rounded-sm font-mono text-[10px] md:text-[11px] font-bold uppercase tracking-wider md:tracking-widest flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 transition-all ${activeTab === 'fleet'
                ? 'bg-amber-gold text-onyx-black shadow-[0_0_8px_rgba(255,184,0,0.3)]'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
                }`}
            >
              <span className="ms text-[14px]">hub</span>
              <span><span className="hidden sm:inline">Mesh </span>Network</span>
            </button>
            <button
              onClick={() => setActiveTab('p25')}
              className={`flex-1 py-1.5 md:py-2 px-2 md:px-3 rounded-sm font-mono text-[10px] md:text-[11px] font-bold uppercase tracking-wider md:tracking-widest flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2 transition-all ${activeTab === 'p25'
                ? 'bg-amber-gold text-onyx-black shadow-[0_0_8px_rgba(255,184,0,0.3)]'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
                }`}
            >
              <span className="ms text-[14px]">radio</span>
              <span>P25 <span className="hidden sm:inline">Call </span>Log</span>
            </button>
          </div>

          {/* ── Active Tab Contents ── */}
          {activeTab === 'chat' && (
            <div className="flex flex-col gap-3 flex-1 min-h-0">
              <h3 className="section-heading flex items-center gap-2 shrink-0">
                <span className="ms text-[14px] text-amber-gold">chat</span>
                Mesh Network Messaging
              </h3>

              <div className="flex-1 flex flex-col border border-white/10 bg-onyx-deep/40 rounded-sm overflow-hidden min-h-0">
                {/* Conversation selector */}
                {conversations.length > 0 && (
                  <div className="flex gap-1.5 p-2 border-b border-white/10 bg-white/5 overflow-x-auto shrink-0 scrollbar-thin">
                    <button
                      onClick={() => setSelectedConv('all')}
                      className={`font-mono text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${selectedConv === 'all'
                        ? 'bg-amber-gold text-onyx-black font-bold'
                        : 'bg-white/10 text-on-surface-variant hover:bg-white/20'
                        }`}
                    >
                      All
                    </button>
                    {conversations.map(conv => (
                      <button
                        key={conv.key}
                        onClick={() => setSelectedConv(conv.key)}
                        className={`font-mono text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${selectedConv === conv.key
                          ? 'bg-amber-gold text-onyx-black font-bold'
                          : 'bg-white/10 text-on-surface-variant hover:bg-white/20'
                          }`}
                      >
                        {conv.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Filter bar */}
                <div className="p-2 border-b border-white/10 bg-white/5 flex gap-2 shrink-0">
                  <input
                    type="text"
                    placeholder="Filter messages..."
                    value={msgFilter}
                    onChange={e => setMsgFilter(e.target.value)}
                    className="flex-1 bg-onyx-black/40 border border-white/10 px-3 py-1 text-[12px] text-on-surface placeholder-on-surface-variant focus:outline-none focus:border-amber-gold/50 transition-colors"
                  />
                </div>

                {/* Message Feed — grouped by conversation */}
                <div className="flex-1 overflow-y-auto p-4 pb-24 lg:pb-28 space-y-4 custom-scrollbar">
                  {messageGroups.length > 0 ? (
                    messageGroups.map(group => (
                      <div key={group.key}>
                        {/* Group header — only shown in "all" view */}
                        {selectedConv === 'all' && (
                          <div className="flex items-center gap-2 mb-2 sticky top-0 bg-onyx-deep/80 backdrop-blur-sm py-1 z-10">
                            <span className="ms text-[12px] text-amber-gold/60">forum</span>
                            <span className="font-mono text-[10px] text-amber-gold/80 uppercase tracking-widest">
                              {prettyConversationLabel(group.key, conversationNames.get(group.key))}
                            </span>
                            <span className="font-mono text-[10px] text-on-surface-variant/50">{group.msgs.length} msg{group.msgs.length !== 1 ? 's' : ''}</span>
                            <div className="flex-1 h-px bg-white/5" />
                          </div>
                        )}
                        <div className="space-y-4">
                          {group.msgs.map((msg, idx) => (
                            <div key={msg.id || `${msg.sender_key || 'unknown'}-${msg.timestamp || 'no-ts'}-${idx}`} className={`flex flex-col ${msg.outgoing ? 'items-end' : 'items-start'}`}>
                              <div className="flex items-center gap-2 mb-1 px-1">
                                <span className="font-bold text-[11px] text-amber-gold uppercase tracking-tight">
                                  {msg.sender_name || 'Unknown'}
                                </span>
                                <span className="font-mono text-[11px] text-on-surface-variant">
                                  {formatTime(msg.timestamp || '')}
                                </span>
                              </div>
                              <div
                                className={`
                                max-w-[85%] px-3 py-2 rounded-lg text-[12px] leading-relaxed
                                ${msg.outgoing
                                    ? 'bg-amber-gold text-onyx-black rounded-tr-none'
                                    : 'bg-white/10 text-on-surface border border-white/5 rounded-tl-none'}
                              `}
                              >
                                {msg.text || '(empty message)'}
                                {msg.msg_type === 'direct' && (
                                  <div className={`text-[11px] mt-1 font-mono uppercase opacity-60 ${msg.outgoing ? 'text-onyx-black' : 'text-amber-gold'}`}>
                                    Direct • {msg.acked ? '✓ Acked' : '⏳ Pending'}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-on-surface-variant/30 py-12">
                      <span className="ms text-4xl mb-3">forum</span>
                      <span className="text-[11px] uppercase tracking-[0.2em]">No mesh traffic detected</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'fleet' && (
            <div className="flex flex-col gap-3 flex-1 min-h-0">
              <h3 className="section-heading flex items-center gap-2 shrink-0">
                <span className="ms text-[14px] text-amber-gold">hub</span>
                Mesh Network Nodes
              </h3>
              <div className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-28 custom-scrollbar">
                <MeshFleetPanel entities={Object.values(entities)} />
              </div>
            </div>
          )}

          {activeTab === 'p25' && (
            <div className="flex flex-col gap-3 flex-1 min-h-0">
              <h3 className="section-heading flex items-center gap-2 shrink-0">
                <span className="ms text-[14px] text-amber-gold">radio</span>
                P25 Digital Transmission Log
              </h3>
              <div className="flex-1 min-h-0 border border-white/10 bg-onyx-deep/40 rounded-sm overflow-hidden flex flex-col">
                <div className="bg-white/5 px-4 py-2.5 border-b border-white/10 flex justify-between items-center shrink-0">
                  <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">
                    Recent Voice & Metadata Feed (30 Events)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-gold animate-pulse" />
                    <span className="font-mono text-[10px] text-amber-gold uppercase tracking-wider">Tuned</span>
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 pb-24 lg:pb-28 space-y-1.5 custom-scrollbar">
                  {p25EventsLog.length > 0 ? (
                    p25EventsLog.map(ev => <TransmissionRow key={ev.event_id} event={ev} />)
                  ) : (
                    <div className="py-12 text-center text-[11px] uppercase font-mono opacity-30">No recent transmissions</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
