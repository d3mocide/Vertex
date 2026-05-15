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
          {isMesh ? 'router' : 'sensors'}
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

function SpectralMonitor({ links, history, status }: { links: MeshLink[]; history: Record<string, { snr: number[], quality: number[] }>; status: any }) {
  // Take top 3 links by SNR
  const topLinks = [...links].sort((a, b) => (b.snr || 0) - (a.snr || 0)).slice(0, 3)

  return (
    <div className="grid grid-cols-1 gap-4 mt-2">
      {/* Local Device Card (Always show if status exists) */}
      {status && (
        <div className="p-3 border border-amber-gold/30 bg-amber-gold/5 rounded-sm flex flex-col gap-3 group">
          <div className="flex items-center justify-between border-b border-amber-gold/10 pb-2">
            <div className="flex items-center gap-2">
              <span className="ms text-[14px] text-amber-gold">router</span>
              <span className="font-bold text-[11px] text-on-surface uppercase truncate">
                Local Station
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${status.connected ? 'bg-green-ais animate-pulse' : 'bg-red-emergency'}`} />
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

      {topLinks.map((link, i) => {
        const key = `${link.node_a}-${link.node_b}`
        const h = history[key] || { snr: [link.snr || 0], quality: [link.link_quality || 0] }

        return (
          <div key={`${link.node_a}-${link.node_b}-${i}`} className="p-3 border border-white/10 bg-white/5 rounded-sm flex flex-col gap-3 hover:bg-white/10 transition-colors group">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <div className="flex items-center gap-2">
                <span className="ms text-[14px] text-amber-gold opacity-70 group-hover:scale-110 transition-transform">hub</span>
                <span className="font-bold text-[11px] text-on-surface uppercase truncate max-w-[100px]">
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

      {topLinks.length === 0 && !status?.connected && (
        <div className="col-span-3 py-10 border border-dashed border-white/10 rounded-sm flex flex-col items-center justify-center opacity-30">
          <span className="ms text-3xl mb-2 animate-pulse">signal_cellular_connected_no_internet_4_bar</span>
          <span className="text-[11px] uppercase font-mono tracking-[0.2em]">Searching for active mesh links...</span>
        </div>
      )}
    </div>
  )
}

export function CommsPanel() {
  const { radio, meshMessages, entities, systemEvents, tracks, meshLinks, linkHistory, meshStatus } = useCivicStore()
  const [msgFilter, setMsgFilter] = useState('')
  const [healthTab, setHealthTab] = useState<'spectral' | 'network'>('spectral')
  const [selectedConv, setSelectedConv] = useState<string>('all')

  // Calculate nearest nodes
  const nearestNodes = useMemo(() => {
    const list = Object.values(entities).filter(e =>
      (e.entity_type === 'mesh_node' || e.entity_type === 'aprs' || e.entity_type === 'tinygs_station') &&
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
      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-24">
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 p-2 sm:p-4 lg:p-6 items-stretch lg:items-start">
          {/* Left Column: Radio & Topology */}
          <div className="flex-1 min-w-0 lg:max-w-md space-y-6">
          {/* RF Communications Card */}
          <section>
            <h3 className="section-heading mb-3 flex items-center gap-2">
              <span className="ms text-[14px] text-amber-gold">radio</span>
              RF Monitoring
            </h3>
            <div className="p-4 border border-amber-gold/30 bg-amber-gold/5 glass-panel mb-4">
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

            {/* Transmission Log */}
            <div className="border border-white/10 bg-white/5 overflow-hidden">
              <div className="bg-white/5 px-3 py-1.5 border-b border-white/5 flex justify-between items-center">
                <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">
                  Recent P25 Activity
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-gold animate-pulse" />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {p25Events.length > 0 ? (
                  p25Events.map(ev => <TransmissionRow key={ev.event_id} event={ev} />)
                ) : (
                  <div className="py-6 text-center text-[11px] uppercase font-mono opacity-30">No recent transmissions</div>
                )}
              </div>
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

          {/* Spectral Health / Fleet Health — tabbed */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="ms text-[14px] text-amber-gold">
                {healthTab === 'spectral' ? 'analytics' : 'hub'}
              </span>
              <div className="flex gap-1">
                {(['spectral', 'network'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setHealthTab(tab)}
                    className={`font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-sm transition-colors ${
                      healthTab === tab
                        ? 'bg-amber-gold text-onyx-black font-bold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {tab === 'spectral' ? 'Spectral' : 'Network'}
                  </button>
                ))}
              </div>
            </div>
            {healthTab === 'spectral'
              ? <SpectralMonitor links={meshLinks} history={linkHistory} status={meshStatus} />
              : <MeshFleetPanel entities={Object.values(entities)} />
            }
          </section>
        </div>

        {/* Right Column: Mesh Chat */}
        <div className="flex-[2] min-w-0 flex flex-col gap-6">
          <h3 className="section-heading mb-3 flex items-center gap-2">
            <span className="ms text-[14px] text-amber-gold">chat</span>
            Network Messaging
          </h3>

          <div className="flex-1 lg:flex-none lg:h-[800px] flex flex-col border border-white/10 bg-onyx-deep/40 rounded-sm overflow-hidden">
            {/* Conversation selector */}
            {conversations.length > 0 && (
              <div className="flex gap-1.5 p-2 border-b border-white/10 bg-white/5 overflow-x-auto shrink-0 scrollbar-thin">
                <button
                  onClick={() => setSelectedConv('all')}
                  className={`font-mono text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${
                    selectedConv === 'all'
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
                    className={`font-mono text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${
                      selectedConv === conv.key
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
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
      </div>
    </div>
  </div>
)
}
