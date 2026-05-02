import { useEffect, useRef, useState } from 'react'
import { useCivicStore } from '../../store'
import { API_BASE, STREAM_URL } from '../../config'
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

type TalkgroupLogRow = {
  tgid: number
  label: string
  lastSeenIso: string
}

type ManagedTalkgroup = {
  id: number
  tgid: number
  name: string
  priority: number
  color: string
  scan_enabled: boolean
}

type ChannelTab = 'streams' | 'talkgroups'

const PRIORITY_LABELS: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4', 5: 'P5' }
const PRIORITY_COLORS: Record<number, string> = {
  1: 'text-red-emergency border-red-emergency/60 bg-red-emergency/10',
  2: 'text-amber-gold border-amber-gold/60 bg-amber-gold/10',
  3: 'text-cyan-adsb border-cyan-adsb/60 bg-cyan-adsb/10',
  4: 'text-on-surface-variant border-white/20',
  5: 'text-on-surface-variant/60 border-white/10',
}

export function TacticalAudio() {
  const audioRef   = useRef<HTMLAudioElement>(null)
  const [playing,  setPlaying]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [volume,   setVolume]   = useState(0.7)
  const [elapsed,  setElapsed]  = useState(0)
  const [showChannels, setShowChannels] = useState(false)
  const [channelTab, setChannelTab] = useState<ChannelTab>('streams')
  const [talkgroupLog, setTalkgroupLog] = useState<TalkgroupLogRow[]>([])
  const [managedTalkgroups, setManagedTalkgroups] = useState<ManagedTalkgroup[]>([])
  const [editingTgid, setEditingTgid] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [selectedTgIdx, setSelectedTgIdx] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { streams, selectedId, setSelectedId, selectedStream } = useRadioStreams()
  const radio = useCivicStore((s) => s.radio)
  const mode  = useCivicStore((s) => s.mode)

  const isActive = radio?.state === 'call'
  const activeStreamUrl = selectedStream?.url ?? STREAM_URL

  useEffect(() => {
    const el = audioRef.current
    if (!el || !playing) return
    el.src = activeStreamUrl
    el.load()
    el.play().catch(() => setPlaying(false))
  }, [activeStreamUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      setElapsed(0)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [playing])

  const toggle = async () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      el.src = ''
      setPlaying(false)
    } else {
      setLoading(true)
      el.src = activeStreamUrl
      el.volume = volume
      el.load()
      try {
        await el.play()
        setPlaying(true)
      } catch {
        setPlaying(false)
      } finally {
        setLoading(false)
      }
    }
  }

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (audioRef.current) audioRef.current.volume = v
  }

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onError = () => { setPlaying(false); setLoading(false) }
    el.addEventListener('error', onError)
    return () => el.removeEventListener('error', onError)
  }, [])

  // Load call log
  useEffect(() => {
    let cancelled = false
    const loadCalls = async () => {
      try {
        const res = await fetch(`${API_BASE}/radio/calls?hours=24`, { headers: authHeaders() })
        if (!res.ok) return
        const calls = (await res.json()) as RadioCallEvent[]
        const byTgid = new Map<number, TalkgroupLogRow>()
        for (const call of calls) {
          const tgid = call.details?.tgid
          if (!tgid || byTgid.has(tgid)) continue
          byTgid.set(tgid, {
            tgid,
            label: call.details?.tag?.trim() || `TGID ${tgid}`,
            lastSeenIso: call.ts,
          })
        }
        if (!cancelled) setTalkgroupLog(Array.from(byTgid.values()).slice(0, 20))
      } catch {
        if (!cancelled) setTalkgroupLog([])
      }
    }
    loadCalls()
    const id = setInterval(loadCalls, 15000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Load managed talkgroups
  const loadManagedTalkgroups = async () => {
    try {
      const res = await fetch(`${API_BASE}/radio/talkgroups`, { headers: authHeaders() })
      if (res.ok) setManagedTalkgroups(await res.json())
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadManagedTalkgroups()
    const id = setInterval(loadManagedTalkgroups, 30000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Create or auto-register a talkgroup from the call log
  const registerTalkgroup = async (row: TalkgroupLogRow) => {
    const existing = managedTalkgroups.find((t) => t.tgid === row.tgid)
    if (existing) return
    try {
      await fetch(`${API_BASE}/radio/talkgroups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ tgid: row.tgid, name: row.label }),
      })
      await loadManagedTalkgroups()
    } catch { /* ignore */ }
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
      await loadManagedTalkgroups()
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
      await loadManagedTalkgroups()
    } catch { /* ignore */ }
  }

  const toggleScan = async (tg: ManagedTalkgroup) => {
    try {
      await fetch(`${API_BASE}/radio/talkgroups/${tg.tgid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ scan_enabled: !tg.scan_enabled }),
      })
      await loadManagedTalkgroups()
    } catch { /* ignore */ }
  }

  const deleteTg = async (tg: ManagedTalkgroup) => {
    try {
      await fetch(`${API_BASE}/radio/talkgroups/${tg.tgid}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      await loadManagedTalkgroups()
    } catch { /* ignore */ }
  }

  const visibleTalkgroups: TalkgroupLogRow[] = (() => {
    const rows = [...talkgroupLog]
    if (radio?.tgid) {
      const liveRow: TalkgroupLogRow = {
        tgid: radio.tgid,
        label: radio.tag?.trim() || `TGID ${radio.tgid}`,
        lastSeenIso: radio.updated || new Date().toISOString(),
      }
      return [liveRow, ...rows.filter((r) => r.tgid !== liveRow.tgid)]
    }
    return rows
  })()

  const skipChannel = (dir: -1 | 1) => {
    if (visibleTalkgroups.length === 0) return
    setSelectedTgIdx((prev) => {
      const base = prev ?? (dir === 1 ? -1 : visibleTalkgroups.length)
      return (base + dir + visibleTalkgroups.length) % visibleTalkgroups.length
    })
    setShowChannels(true)
  }

  const selectedTg = selectedTgIdx !== null ? visibleTalkgroups[selectedTgIdx] ?? null : null

  const resolveName = (tgid: number, fallback: string) =>
    managedTalkgroups.find((t) => t.tgid === tgid)?.name || fallback

  const activeTag = selectedTg
    ? resolveName(selectedTg.tgid, selectedTg.label)
    : radio?.tgid
      ? resolveName(radio.tgid, radio.tag ?? `TGID ${radio.tgid}`)
      : selectedStream?.name ?? 'SCAN'

  const formatElapsed = (s: number) => {
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `00:${mm}:${ss}`
  }

  const isCritical = mode === 'critical'

  return (
    <aside
      className={`
        absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col justify-end items-end w-[1040px] max-w-[98vw] pointer-events-none transition-all duration-300
        ${isCritical ? 'scale-105 origin-bottom' : 'scale-100 origin-bottom'}
      `}
      aria-label="Tactical audio console"
    >
      {/* Pop-up Channels Panel */}
      {showChannels && (
        <div className="hud-panel w-80 mb-4 overflow-hidden pointer-events-auto origin-bottom-right animate-in fade-in slide-in-from-bottom-2 duration-200">

          {/* Tab bar */}
          <div className="flex border-b border-amber-gold-muted/30">
            {(['streams', 'talkgroups'] as ChannelTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setChannelTab(tab)}
                className={`
                  flex-1 px-3 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors focus:outline-none
                  ${channelTab === tab
                    ? 'text-amber-gold border-b-2 border-amber-gold'
                    : 'text-on-surface-variant hover:text-on-surface border-b-2 border-transparent'
                  }
                `}
              >
                {tab === 'streams' ? 'STREAMS' : `TALKGROUPS (${managedTalkgroups.length})`}
              </button>
            ))}
          </div>

          {/* Streams tab */}
          {channelTab === 'streams' && (
            <nav className="max-h-64 overflow-y-auto">
              {streams.filter((s) => s.enabled).length === 0 ? (
                <div className="px-4 py-3 text-[10px] tracking-wide text-on-surface-variant/80 uppercase">
                  No streams configured
                </div>
              ) : (
                streams.filter((s) => s.enabled).map((stream) => {
                  const isSelected = selectedId === stream.id
                  return (
                    <button
                      key={stream.id}
                      onClick={() => setSelectedId(stream.id)}
                      className={`
                        w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold
                        ${isSelected
                          ? 'bg-amber-gold-muted/30 text-amber-gold border-l-2 border-amber-gold'
                          : 'text-on-surface-variant hover:bg-surface-container border-l-2 border-transparent'
                        }
                      `}
                      aria-pressed={isSelected}
                    >
                      <span className="ms text-[18px] leading-none" aria-hidden="true">radio</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold tracking-widest uppercase truncate">{stream.name}</div>
                        <div className="text-[9px] text-on-surface-variant/60 truncate">{stream.format.toUpperCase()}</div>
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

          {/* Talkgroups tab — managed list */}
          {channelTab === 'talkgroups' && (
            <div className="max-h-72 overflow-y-auto">
              {/* Unregistered talkgroups from call log */}
              {visibleTalkgroups.filter((r) => !managedTalkgroups.find((t) => t.tgid === r.tgid)).length > 0 && (
                <div>
                  <div className="px-4 pt-2 pb-1 text-[8px] text-on-surface-variant/50 uppercase tracking-widest">
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
                            <div className="text-[10px] font-bold uppercase truncate">{ch.label}</div>
                          </div>
                          <div className="font-mono text-[9px] opacity-50">{ch.tgid}</div>
                          {isLive && <span className="w-1.5 h-1.5 rounded-full bg-amber-gold animate-pulse shrink-0" />}
                        </button>
                      )
                    })}
                </div>
              )}

              {/* Managed talkgroups */}
              {managedTalkgroups.length > 0 && (
                <div>
                  <div className="px-4 pt-2 pb-1 text-[8px] text-on-surface-variant/50 uppercase tracking-widest">
                    Managed
                  </div>
                  {managedTalkgroups.map((tg) => {
                    const isLive = radio?.tgid === tg.tgid
                    const isEditing = editingTgid === tg.tgid
                    const pColor = PRIORITY_COLORS[tg.priority] ?? PRIORITY_COLORS[3]
                    return (
                      <div
                        key={tg.tgid}
                        className={`
                          px-3 py-2 flex items-center gap-2 border-b border-white/5
                          ${isLive ? 'bg-amber-gold-muted/10' : ''}
                        `}
                      >
                        {/* Priority selector */}
                        <div className="relative group shrink-0">
                          <span className={`font-mono text-[8px] border px-1 py-0.5 cursor-pointer select-none ${pColor}`}>
                            {PRIORITY_LABELS[tg.priority] ?? 'P3'}
                          </span>
                          <div className="absolute bottom-full left-0 mb-1 hidden group-hover:flex flex-col bg-onyx-deep border border-white/10 z-10">
                            {[1, 2, 3, 4, 5].map((p) => (
                              <button
                                key={p}
                                onClick={() => setPriority(tg, p)}
                                className={`px-2 py-1 text-[8px] font-mono hover:bg-surface-container text-left ${
                                  tg.priority === p ? 'text-amber-gold' : 'text-on-surface-variant'
                                }`}
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
                              className="w-full bg-onyx-deep border border-amber-gold/60 text-on-surface text-[10px] px-1 py-0.5 focus:outline-none"
                            />
                          ) : (
                            <button
                              onClick={() => startEdit(tg)}
                              className="text-[10px] font-bold uppercase truncate w-full text-left hover:text-amber-gold transition-colors focus:outline-none"
                              title="Click to rename"
                            >
                              {tg.name}
                            </button>
                          )}
                          <div className="font-mono text-[8px] text-on-surface-variant/50">{tg.tgid}</div>
                        </div>

                        {/* Scan toggle */}
                        <button
                          onClick={() => toggleScan(tg)}
                          title={tg.scan_enabled ? 'Scan enabled — click to disable' : 'Scan disabled — click to enable'}
                          className={`shrink-0 ms text-[16px] leading-none transition-colors focus:outline-none ${
                            tg.scan_enabled ? 'text-green-ais' : 'text-on-surface-variant/30'
                          }`}
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          {tg.scan_enabled ? 'toggle_on' : 'toggle_off'}
                        </button>

                        {/* Live indicator */}
                        {isLive && <span className="w-1.5 h-1.5 rounded-full bg-amber-gold animate-pulse shrink-0" />}

                        {/* Delete */}
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
                <div className="px-4 py-3 text-[10px] tracking-wide text-on-surface-variant/80 uppercase">
                  Awaiting radio activity…
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Bottom Bar */}
      <div className="bg-white/[0.03] border border-white/10 backdrop-blur-md rounded-full h-12 w-full flex items-center px-4 md:px-5 pointer-events-auto relative shadow-[0_8px_32px_rgba(0,0,0,0.4)]">

        {/* Left Section */}
        <div className="flex flex-1 items-center gap-2.5 min-w-0 mr-[110px] md:mr-[120px] lg:mr-[150px]">
          <div className="w-8 h-8 rounded-full border border-amber-gold/30 flex items-center justify-center bg-black/40 shrink-0">
            <span className="ms text-[18px] text-amber-gold leading-none" aria-hidden="true" style={{ fontVariationSettings: "'FILL' 1" }}>
              cell_tower
            </span>
          </div>
          <div className="min-w-0 flex items-center gap-2.5">
            <h2 className="font-bold text-[11px] tracking-tight text-on-surface uppercase truncate">
              {activeTag}
            </h2>
            <div className="w-px h-3 bg-white/10 shrink-0" />
            <div className="flex items-center gap-2 font-mono text-[9px] text-on-surface-variant truncate">
              <span>
                {selectedTg && selectedTg.tgid !== radio?.tgid
                  ? `TGID ${selectedTg.tgid}`
                  : radio?.tgid
                    ? `TGID ${radio.tgid}`
                    : 'TACTICAL AUDIO'}
              </span>
              {radio?.freq_hz && !selectedTg && (
                <>
                  <span className="opacity-50">•</span>
                  <span>{(radio.freq_hz / 1e6).toFixed(4)} MHz</span>
                </>
              )}
            </div>
            {isActive && (
              <div className="flex items-center gap-1.5 shrink-0 bg-red-emergency/20 border border-red-emergency/30 px-1.5 py-0.5 rounded-full">
                <span className="w-1 h-1 rounded-full bg-red-emergency animate-pulse" aria-hidden="true" />
                <span className="font-mono text-[8px] text-red-emergency uppercase font-bold">LIVE</span>
              </div>
            )}
          </div>
        </div>

        {/* Middle Section — Playback Controls */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3 shrink-0 h-full">
          <button
            onClick={() => skipChannel(-1)}
            disabled={visibleTalkgroups.length === 0}
            className="text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-none flex disabled:opacity-30"
            aria-label="Previous channel"
          >
            <span className="ms text-[18px]">skip_previous</span>
          </button>

          <button
            onClick={toggle}
            disabled={loading}
            className={`
              w-10 h-10 rounded-full border border-amber-gold flex items-center justify-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white
              ${loading
                ? 'bg-amber-gold-muted text-onyx-black cursor-wait opacity-80'
                : playing
                  ? 'bg-amber-gold text-onyx-black hover:bg-amber-400 hover:scale-105 shadow-[0_0_20px_rgba(255,184,0,0.4)]'
                  : 'text-amber-gold hover:bg-amber-gold/10'
              }
            `}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            <span className="ms text-[24px] leading-none ml-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>
              {playing ? 'pause' : 'play_arrow'}
            </span>
          </button>

          <button
            onClick={() => skipChannel(1)}
            disabled={visibleTalkgroups.length === 0}
            className="text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-none flex disabled:opacity-30"
            aria-label="Next channel"
          >
            <span className="ms text-[18px]">skip_next</span>
          </button>
        </div>

        {/* Right Section */}
        <div className="flex flex-1 items-center justify-end gap-5 min-w-0 ml-[120px] md:ml-[140px] lg:ml-[180px]">
          <div className="hidden sm:flex items-center">
            <span className="font-mono text-[11px] text-amber-gold w-14 tracking-wider text-right font-semibold">
              {playing ? formatElapsed(elapsed) : '00:00:00'}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <span className="ms text-[18px] text-on-surface-variant" aria-hidden="true">
              {volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}
            </span>
            <label className="sr-only" htmlFor="volume-slider">Volume</label>
            <div className="relative h-1 w-16 md:w-20 bg-surface-container-highest cursor-pointer group rounded-full overflow-hidden">
              <div
                className="absolute left-0 top-0 bottom-0 bg-amber-gold transition-all group-hover:bg-amber-400"
                style={{ width: `${volume * 100}%` }}
                aria-hidden="true"
              />
              <input
                id="volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={handleVolume}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(volume * 100)}
              />
            </div>
          </div>

          <button
            onClick={() => setShowChannels(!showChannels)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-gold/30 text-[10px] font-bold tracking-widest uppercase transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold
              ${showChannels ? 'bg-amber-gold text-onyx-black border-amber-gold' : 'text-amber-gold hover:bg-amber-gold/10 hover:border-amber-gold/50'}
            `}
          >
            <span className="ms text-[14px] leading-none">format_list_bulleted</span>
            <span className="hidden md:inline text-[9px]">CHANNELS</span>
          </button>
        </div>
      </div>
      <audio ref={audioRef} preload="none" className="hidden" aria-hidden="true" />
    </aside>
  )
}
