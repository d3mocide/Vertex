import { useState, useEffect, useRef } from 'react'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'
import { useRadioStreams } from '../../hooks/useRadioStreams'

type RadioCallEvent = {
  event_id: string
  event_type: 'p25_call_start' | 'p25_call_end' | string
  ts: string
  details?: {
    tgid?: number
    tag?: string
    [k: string]: unknown
  }
}

export type TalkgroupLogRow = {
  tgid: number
  label: string
  lastSeenIso: string
}

export type ManagedTalkgroup = {
  id: number
  tgid: number
  name: string
  priority: number
  color: string
  scan_enabled: boolean
}

const PRIORITY_LABELS: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4', 5: 'P5' }
const PRIORITY_COLORS: Record<number, string> = {
  1: 'text-red-emergency border-red-emergency/60 bg-red-emergency/10',
  2: 'text-amber-gold border-amber-gold/60 bg-amber-gold/10',
  3: 'text-cyan-adsb border-cyan-adsb/60 bg-cyan-adsb/10',
  4: 'text-on-surface-variant border-white/20',
  5: 'text-on-surface-variant/60 border-white/10',
}

type P25Recording = {
  id: number
  call_id: string
  tgid: number
  tag: string
  started_at: string
  ended_at: string | null
  duration_s: number | null
  file_size_bytes: number | null
  transcription: string | null
}

type ChannelTab = 'streams' | 'talkgroups' | 'recordings'

interface ChannelsPanelProps {
  visibleTalkgroups: TalkgroupLogRow[]
  managedTalkgroups: ManagedTalkgroup[]
  playing: boolean
  onReload: () => Promise<void>
}

export function ChannelsPanel({ visibleTalkgroups, managedTalkgroups, playing, onReload }: ChannelsPanelProps) {
  const [channelTab, setChannelTab] = useState<ChannelTab>('streams')
  const [editingTgid, setEditingTgid] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [recordings, setRecordings] = useState<P25Recording[]>([])
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const { streams, selectedId, setSelectedId } = useRadioStreams()
  const radio = useCivicStore((s) => s.radio)

  useEffect(() => {
    if (channelTab !== 'recordings') return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/radio/recordings?hours=168&limit=50`, { headers: authHeaders() })
        if (!res.ok || cancelled) return
        setRecordings(await res.json())
      } catch { /* ignore */ }
    }
    load()
    const id = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(id) }
  }, [channelTab])

  const playRecording = (rec: P25Recording) => {
    const el = audioRef.current
    if (!el) return
    if (playingId === rec.id) {
      el.pause()
      setPlayingId(null)
    } else {
      el.src = `${API_BASE}/radio/recordings/${rec.id}/file`
      el.load()
      el.play().catch(() => {})
      setPlayingId(rec.id)
    }
  }

  const formatDuration = (s: number | null) => {
    if (s == null) return '--'
    const m = Math.floor(s / 60)
    const sec = Math.round(s % 60)
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  const formatTs = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const startEdit = (tg: ManagedTalkgroup) => {
    setEditingTgid(tg.tgid)
    setEditName(tg.name)
  }

  const commitEdit = async (tg: ManagedTalkgroup) => {
    if (!editName.trim()) { setEditingTgid(null); return }
    try {
      await fetch(`${API_BASE}/radio/talkgroups/${tg.tgid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: editName.trim() }),
      })
      await onReload()
    } catch { /* ignore */ } finally {
      setEditingTgid(null)
    }
  }

  const setPriority = async (tg: ManagedTalkgroup, priority: number) => {
    try {
      await fetch(`${API_BASE}/radio/talkgroups/${tg.tgid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ priority }),
      })
      await onReload()
    } catch { /* ignore */ }
  }

  const toggleScan = async (tg: ManagedTalkgroup) => {
    try {
      await fetch(`${API_BASE}/radio/talkgroups/${tg.tgid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ scan_enabled: !tg.scan_enabled }),
      })
      await onReload()
    } catch { /* ignore */ }
  }

  const deleteTg = async (tg: ManagedTalkgroup) => {
    try {
      await fetch(`${API_BASE}/radio/talkgroups/${tg.tgid}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      await onReload()
    } catch { /* ignore */ }
  }

  const registerTalkgroup = async (row: TalkgroupLogRow) => {
    const existing = managedTalkgroups.find((t) => t.tgid === row.tgid)
    if (existing) return
    try {
      await fetch(`${API_BASE}/radio/talkgroups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ tgid: row.tgid, name: row.label }),
      })
      await onReload()
    } catch { /* ignore */ }
  }

  return (
    <div className="hud-panel w-80 mb-4 overflow-hidden pointer-events-auto origin-bottom-right animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Tab bar */}
      <div className="flex border-b border-amber-gold-muted/30">
        {(['streams', 'talkgroups', 'recordings'] as ChannelTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setChannelTab(tab)}
            className={`flex-1 px-2 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors focus:outline-none ${channelTab === tab ? 'text-amber-gold border-b-2 border-amber-gold' : 'text-on-surface-variant hover:text-on-surface border-b-2 border-transparent'}`}
          >
            {tab === 'streams' ? 'STREAMS' : tab === 'talkgroups' ? `TGs (${managedTalkgroups.length})` : `REC (${recordings.length})`}
          </button>
        ))}
      </div>
      <audio ref={audioRef} preload="none" className="hidden" onEnded={() => setPlayingId(null)} />

      {/* Streams tab */}
      {channelTab === 'streams' && (
        <nav className="max-h-64 overflow-y-auto">
          {streams.filter((s) => s.enabled).length === 0 ? (
            <div className="px-4 py-3 text-[11px] tracking-wide text-on-surface-variant/80 uppercase">
              No streams configured
            </div>
          ) : (
            streams.filter((s) => s.enabled).map((stream) => {
              const isSelected = selectedId === stream.id
              return (
                <button
                  key={stream.id}
                  onClick={() => setSelectedId(stream.id)}
                  className={`w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${isSelected ? 'bg-amber-gold-muted/30 text-amber-gold border-l-2 border-amber-gold' : 'text-on-surface-variant hover:bg-surface-container border-l-2 border-transparent'}`}
                  aria-pressed={isSelected}
                >
                  <span className="ms text-[18px] leading-none" aria-hidden="true">radio</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold tracking-widest uppercase truncate">{stream.name}</div>
                    <div className="text-[11px] text-on-surface-variant/60 truncate">{stream.format.toUpperCase()}</div>
                  </div>
                  {isSelected && playing && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-gold animate-pulse shrink-0" aria-hidden="true" />
                  )}
                </button>
              )
            })
          )}
        </nav>
      )}

      {/* Talkgroups tab */}
      {channelTab === 'talkgroups' && (
        <div className="max-h-72 overflow-y-auto">
          {/* Unregistered talkgroups from call log */}
          {visibleTalkgroups.filter((r) => !managedTalkgroups.find((t) => t.tgid === r.tgid)).length > 0 && (
            <div>
              <div className="px-4 pt-2 pb-1 text-[11px] text-on-surface-variant/50 uppercase tracking-widest">
                Seen in last 24h — click to register
              </div>
              {visibleTalkgroups
                .filter((r) => !managedTalkgroups.find((t) => t.tgid === r.tgid))
                .map((ch) => {
                  const isLive = radio?.tgid === ch.tgid
                  return (
                    <button
                      key={ch.tgid}
                      onClick={() => registerTalkgroup(ch)}
                      className="w-full px-4 py-2 flex items-center gap-3 text-left text-on-surface-variant hover:bg-surface-container transition-colors focus:outline-none border-l-2 border-transparent"
                    >
                      <span className="ms text-[14px] leading-none" aria-hidden="true">add_circle</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold uppercase truncate">{ch.label}</div>
                      </div>
                      <div className="font-mono text-[11px] opacity-50">{ch.tgid}</div>
                      {isLive && <span className="w-1.5 h-1.5 rounded-full bg-amber-gold animate-pulse shrink-0" />}
                    </button>
                  )
                })}
            </div>
          )}

          {/* Managed talkgroups */}
          {managedTalkgroups.length > 0 && (
            <div>
              <div className="px-4 pt-2 pb-1 text-[11px] text-on-surface-variant/50 uppercase tracking-widest">Managed</div>
              {managedTalkgroups.map((tg) => {
                const isLive = radio?.tgid === tg.tgid
                const isEditing = editingTgid === tg.tgid
                const pColor = PRIORITY_COLORS[tg.priority] ?? PRIORITY_COLORS[3]
                return (
                  <div
                    key={tg.tgid}
                    className={`px-3 py-2 flex items-center gap-2 border-b border-white/5 ${isLive ? 'bg-amber-gold-muted/10' : ''}`}
                  >
                    {/* Priority selector */}
                    <div className="relative group shrink-0">
                      <span className={`font-mono text-[11px] border px-1 py-0.5 cursor-pointer select-none ${pColor}`}>
                        {PRIORITY_LABELS[tg.priority] ?? 'P3'}
                      </span>
                      <div className="absolute bottom-full left-0 mb-1 hidden group-hover:flex flex-col bg-onyx-deep border border-white/10 z-10">
                        {[1, 2, 3, 4, 5].map((p) => (
                          <button
                            key={p}
                            onClick={() => setPriority(tg, p)}
                            className={`px-2 py-1 text-[11px] font-mono hover:bg-surface-container text-left ${tg.priority === p ? 'text-amber-gold' : 'text-on-surface-variant'}`}
                          >
                            {PRIORITY_LABELS[p]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Name (editable) */}
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => commitEdit(tg)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(tg)
                            if (e.key === 'Escape') setEditingTgid(null)
                          }}
                          className="w-full bg-onyx-deep border border-amber-gold/60 text-on-surface text-[11px] px-1 py-0.5 focus:outline-none"
                        />
                      ) : (
                        <button
                          onClick={() => startEdit(tg)}
                          className="text-[11px] font-bold uppercase truncate w-full text-left hover:text-amber-gold transition-colors focus:outline-none"
                          title="Click to rename"
                        >
                          {tg.name}
                        </button>
                      )}
                      <div className="font-mono text-[11px] text-on-surface-variant/50">{tg.tgid}</div>
                    </div>

                    {/* Scan toggle */}
                    <button
                      onClick={() => toggleScan(tg)}
                      title={tg.scan_enabled ? 'Scan enabled — click to disable' : 'Scan disabled — click to enable'}
                      className={`shrink-0 ms text-[16px] leading-none transition-colors focus:outline-none ${tg.scan_enabled ? 'text-green-ais' : 'text-on-surface-variant/30'}`}
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      {tg.scan_enabled ? 'toggle_on' : 'toggle_off'}
                    </button>

                    {isLive && <span className="w-1.5 h-1.5 rounded-full bg-amber-gold animate-pulse shrink-0" />}

                    <button
                      onClick={() => deleteTg(tg)}
                      className="shrink-0 ms text-[14px] text-on-surface-variant/30 hover:text-red-emergency transition-colors leading-none focus:outline-none"
                    >
                      delete
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {visibleTalkgroups.length === 0 && managedTalkgroups.length === 0 && (
            <div className="px-4 py-3 text-[11px] tracking-wide text-on-surface-variant/80 uppercase">
              Awaiting radio activity…
            </div>
          )}
        </div>
      )}

      {/* Recordings tab */}
      {channelTab === 'recordings' && (
        <div className="max-h-80 overflow-y-auto">
          {recordings.length === 0 ? (
            <div className="px-4 py-3 text-[11px] tracking-wide text-on-surface-variant/80 uppercase">
              No recordings — enable P25_AUDIO_ENABLED in .env
            </div>
          ) : (
            recordings.map((rec) => {
              const isPlaying = playingId === rec.id
              return (
                <div
                  key={rec.id}
                  className={`px-3 py-2 flex items-center gap-2 border-b border-white/5 ${isPlaying ? 'bg-amber-gold-muted/10' : ''}`}
                >
                  <button
                    onClick={() => playRecording(rec)}
                    className={`shrink-0 ms text-[20px] leading-none transition-colors focus:outline-none ${isPlaying ? 'text-amber-gold' : 'text-on-surface-variant hover:text-amber-gold'}`}
                    style={{ fontVariationSettings: "'FILL' 1" }}
                    aria-label={isPlaying ? 'Pause recording' : 'Play recording'}
                  >
                    {isPlaying ? 'pause_circle' : 'play_circle'}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold uppercase truncate">
                      {rec.tag || `TGID ${rec.tgid}`}
                    </div>
                    <div className="font-mono text-[11px] text-on-surface-variant/60">
                      {formatTs(rec.started_at)} · {formatDuration(rec.duration_s)}
                    </div>
                    {rec.transcription && (
                      <div className="text-[11px] text-on-surface-variant/80 italic mt-0.5 line-clamp-2 leading-snug">
                        "{rec.transcription}"
                      </div>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-on-surface-variant/40 shrink-0">{rec.tgid}</div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
