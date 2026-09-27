import { useEffect, useRef, useState } from 'react'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'
import { useRadioStreams } from '../../hooks/useRadioStreams'
import { ChannelsPanel, type TalkgroupLogRow, type ManagedTalkgroup } from './ChannelsPanel'
import { P25LivePlayer, type LiveState } from '../../audio/p25Live'
import {
  type AudioSource, type ListenFilter,
  loadAudioSource, saveAudioSource, loadListenFilter, saveListenFilter, makeWants, makePriorityOf,
} from '../../audio/listenFilter'

type RadioCallEvent = {
  event_id: string
  event_type: string
  ts: string
  details?: { tgid?: number; tag?: string; [k: string]: unknown }
}

export function TacticalAudio() {
  const audioRef   = useRef<HTMLAudioElement>(null)
  const [playing,  setPlaying]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [volume,   setVolume]   = useState(0.7)
  const [elapsed,  setElapsed]  = useState(0)
  const [showChannels, setShowChannels] = useState(false)
  const [talkgroupLog, setTalkgroupLog] = useState<TalkgroupLogRow[]>([])
  const [managedTalkgroups, setManagedTalkgroups] = useState<ManagedTalkgroup[]>([])
  const [selectedTgIdx, setSelectedTgIdx] = useState<number | null>(null)
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const driftRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const stallRef    = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const STALL_TIMEOUT_MS = 8_000

  const { streams, selectedId, selectedStream, setSelectedId } = useRadioStreams()
  // "live": OP25 receivers straight from /ws/radio, filtered by talkgroup.
  // "stream": the selected Icecast stream (keeps playing with the screen locked).
  const [source, setSource] = useState<AudioSource>(loadAudioSource)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const [listen, setListen] = useState<ListenFilter>(loadListenFilter)
  const [live, setLive] = useState<LiveState>({ connected: false, nowPlaying: null, delayed: false, held: [] })
  const playerRef = useRef<P25LivePlayer | null>(null)
  if (!playerRef.current) playerRef.current = new P25LivePlayer()
  const radio = useCivicStore((s) => s.radio)
  const mode  = useCivicStore((s) => s.mode)

  const isActive = radio?.state === 'call'
  // Use backend proxy endpoint for all streams (handles private network IPs)
  const activeStreamUrl = selectedStream?.id ? `${API_BASE}/radio/proxy/${selectedStream.id}` : ''

  useEffect(() => {
    const player = playerRef.current!
    player.onChange = setLive
    return () => player.stop()
  }, [])

  useEffect(() => {
    const el = audioRef.current
    if (!el || !playing || source === 'live' || el.src.endsWith(activeStreamUrl)) return
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

  const stopStream = () => {
    const el = audioRef.current
    if (!el) return
    el.pause()
    el.removeAttribute('src')
    el.load()
    stopDriftCorrection()
    clearStallTimer()
  }

  const toggle = async () => {
    if (source === 'live') {
      const player = playerRef.current!
      if (playing) {
        player.stop()
        setPlaying(false)
      } else {
        player.setVolume(volume)
        player.start()
        setPlaying(true)
      }
      return
    }
    if (playing) {
      stopStream()
      setPlaying(false)
    } else {
      await startStream(activeStreamUrl)
    }
  }

  const startStream = async (url: string) => {
    const el = audioRef.current
    if (!el) return
    setLoading(true)
    el.src = url
    el.volume = volume
    el.load()
    // Snap to the live edge once the browser has buffered enough data.
    // Seek to just before the buffer end (within the buffer) so the browser
    // doesn't enter a waiting state chasing a position that never arrives.
    el.addEventListener('canplay', function snapToLive() {
      if (el.buffered.length > 0) {
        try { el.currentTime = Math.max(0, el.buffered.end(el.buffered.length - 1) - 0.5) } catch { /* ignore */ }
      }
    }, { once: true })
    try {
      await el.play()
      setPlaying(true)
    } catch {
      setPlaying(false)
    } finally {
      setLoading(false)
    }
  }

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (audioRef.current) audioRef.current.volume = v
    playerRef.current!.setVolume(v)
  }

  // Switch between live listening and an Icecast stream (from a click, so the
  // new source is allowed to start playing).
  const selectSource = (next: 'live' | number) => {
    const nextSource: AudioSource = next === 'live' ? 'live' : 'stream'
    if (next !== 'live') setSelectedId(next)
    setSource(nextSource)
    saveAudioSource(nextSource)
    if (!playing || nextSource === source) return
    if (nextSource === 'live') {
      stopStream()
      playerRef.current!.setVolume(volume)
      playerRef.current!.start()
    } else {
      playerRef.current!.stop()
      void startStream(`${API_BASE}/radio/proxy/${next}`)
    }
  }

  const stopDriftCorrection = () => {
    if (driftRef.current) { clearInterval(driftRef.current); driftRef.current = null }
  }

  const clearStallTimer = () => {
    if (stallRef.current) { clearTimeout(stallRef.current); stallRef.current = null }
  }

  const startDriftCorrection = (el: HTMLAudioElement) => {
    stopDriftCorrection()
    driftRef.current = setInterval(() => {
      if (!el || el.paused) return
      if (el.buffered.length > 0) {
        const liveEdge = el.buffered.end(el.buffered.length - 1)
        if (liveEdge - el.currentTime > 2) {
          try { el.currentTime = liveEdge } catch { /* ignore */ }
        }
      }
    }, 30_000)
  }

  // Stall recovery: reload the stream if audio stalls for more than STALL_TIMEOUT_MS.
  // Also owns drift correction so it isn't killed by cleanup racing the state update.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    if (playing) startDriftCorrection(el)

    const onError = () => {
      if (sourceRef.current === 'live') return
      clearStallTimer()
      stopDriftCorrection()
      setPlaying(false)
      setLoading(false)
    }

    const onStall = () => {
      if (!playing || sourceRef.current === 'live') return
      clearStallTimer()
      stallRef.current = setTimeout(async () => {
        if (!audioRef.current || !playing) return
        const src = audioRef.current.src
        audioRef.current.src = ''
        audioRef.current.load()
        audioRef.current.src = src
        audioRef.current.load()
        // Seek within the buffer (not beyond it) to avoid an indefinite waiting state
        audioRef.current.addEventListener('canplay', function snapToLive() {
          const a = audioRef.current
          if (a && a.buffered.length > 0) {
            try { a.currentTime = Math.max(0, a.buffered.end(a.buffered.length - 1) - 0.5) } catch { /* ignore */ }
          }
        }, { once: true })
        try {
          await audioRef.current.play()
        } catch {
          setPlaying(false)
        }
      }, STALL_TIMEOUT_MS)
    }

    const onPlaying = () => clearStallTimer()

    el.addEventListener('error',   onError)
    el.addEventListener('stalled', onStall)
    el.addEventListener('waiting', onStall)
    el.addEventListener('playing', onPlaying)
    return () => {
      el.removeEventListener('error',   onError)
      el.removeEventListener('stalled', onStall)
      el.removeEventListener('waiting', onStall)
      el.removeEventListener('playing', onPlaying)
      clearStallTimer()
      stopDriftCorrection()
    }
  }, [playing]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const wants = makeWants(listen, managedTalkgroups)
  const listenCount = listen.mode === 'all' ? null : managedTalkgroups.filter((t) => wants(t.tgid)).length

  useEffect(() => {
    saveListenFilter(listen)
    const player = playerRef.current!
    player.wants = makeWants(listen, managedTalkgroups)
    player.priorityOf = makePriorityOf(managedTalkgroups)
    player.refilter()
  }, [listen, managedTalkgroups])

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

  const liveMode = source === 'live'
  const liveCall = liveMode && playing ? live.nowPlaying : null
  const livePriority = liveCall ? managedTalkgroups.find((t) => t.tgid === liveCall.tgid)?.priority : undefined

  const activeTag = liveMode
    ? liveCall
      ? resolveName(liveCall.tgid, liveCall.tag.trim() || (liveCall.tgid ? `TGID ${liveCall.tgid}` : 'Unknown talkgroup'))
      : 'P25 Live'
    : selectedTg
    ? resolveName(selectedTg.tgid, selectedTg.label)
    : radio?.tgid
      ? resolveName(radio.tgid, radio.tag ?? `TGID ${radio.tgid}`)
      : selectedStream?.name ?? 'SCAN'

  const listenSummary = listenCount === null ? 'ALL TGS' : `${listenCount} TGS`
  const liveSubline = liveCall
    ? `TGID ${liveCall.tgid || '?'} · RX${liveCall.ch}`
    : !playing
      ? `LISTENING TO ${listenSummary}`
      : live.connected ? `SCANNING ${listenSummary}` : 'CONNECTING…'

  const formatElapsed = (s: number) => {
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `00:${mm}:${ss}`
  }

  const isCritical = mode === 'critical'

  return (
    <aside
      // Mobile: a flat bar docked directly above the bottom nav (the page
      // scroller reserves its height). Desktop: the floating console pill.
      className={`fixed lg:absolute inset-x-0 bottom-[calc(3.5rem_+_env(safe-area-inset-bottom))] lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:-translate-x-1/2 z-40 flex flex-col justify-end items-end w-full lg:w-[1040px] lg:max-w-[98vw] pointer-events-none transition-all duration-300 ${isCritical ? 'lg:scale-105 origin-bottom' : 'scale-100 origin-bottom'}`}
      aria-label="Tactical audio console"
    >
      {/* Pop-up Channels Panel */}
      {showChannels && (
        <ChannelsPanel
          visibleTalkgroups={visibleTalkgroups}
          managedTalkgroups={managedTalkgroups}
          playing={playing}
          onReload={loadManagedTalkgroups}
          streams={streams}
          selectedStreamId={selectedId}
          source={source}
          onSelectSource={selectSource}
          listen={listen}
          onListenChange={setListen}
          wants={wants}
          liveTgid={liveCall?.tgid ?? null}
        />
      )}

      {/* Main Bottom Bar */}
      <div className="bg-onyx-deep/90 lg:bg-white/[0.03] border-t lg:border border-white/10 backdrop-blur-md lg:rounded-full h-12 w-full flex items-center px-3 lg:px-5 pointer-events-auto relative lg:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">

        {/* Left Section */}
        <div className="flex flex-1 items-center gap-2 min-w-0 mr-2 lg:mr-[150px]">
          <div className="w-8 h-8 rounded-full border border-amber-gold/30 flex items-center justify-center bg-black/40 shrink-0">
            <span className="ms text-[18px] text-amber-gold leading-none" aria-hidden="true" style={{ fontVariationSettings: "'FILL' 1" }}>cell_tower</span>
          </div>
          <div className="min-w-0 flex items-center gap-2 sm:gap-2.5">
            <h2 className="font-bold text-[12px] lg:text-[11px] tracking-tight text-on-surface uppercase truncate">{activeTag}</h2>
            <div className="hidden lg:block w-px h-3 bg-white/10 shrink-0" />
            {liveMode ? (
            <div className="hidden lg:flex items-center gap-2 font-mono text-[11px] text-on-surface-variant truncate">
              <span>{liveSubline}</span>
            </div>
            ) : (
            <div className="hidden lg:flex items-center gap-2 font-mono text-[11px] text-on-surface-variant truncate">
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
            )}
            {liveMode && playing && (liveCall || live.held.length > 0) && (
              <div className="flex items-center gap-1.5 shrink-0">
                {livePriority != null && livePriority <= 2 && (
                  <span className={`font-mono text-[11px] border px-1 py-0.5 ${livePriority === 1 ? 'text-red-emergency border-red-emergency/60 bg-red-emergency/10' : 'text-amber-gold border-amber-gold/60 bg-amber-gold/10'}`}>
                    P{livePriority}
                  </span>
                )}
                {liveCall && (live.delayed ? (
                  <span className="font-mono text-[11px] text-amber-p25 border border-amber-p25/40 px-1.5 py-0.5 uppercase font-bold" title="This call overlapped another and was held">HELD</span>
                ) : (
                  <div className="flex items-center gap-1.5 bg-red-emergency/20 border border-red-emergency/30 px-1.5 py-0.5 rounded-full">
                    <span className="w-1 h-1 rounded-full bg-red-emergency animate-pulse" aria-hidden="true" />
                    <span className="font-mono text-[11px] text-red-emergency uppercase font-bold">LIVE</span>
                  </div>
                ))}
                {live.held.length > 0 && (
                  <span className="font-mono text-[11px] text-amber-p25 border border-amber-p25/40 px-1.5 py-0.5" title="Overlapping calls waiting to play">
                    +{live.held.length} NEXT
                  </span>
                )}
              </div>
            )}
            {!liveMode && isActive && (
              <div className="flex items-center gap-1.5 shrink-0">
                {radio?.priority != null && radio.priority <= 2 && (
                  <span className={`font-mono text-[11px] border px-1 py-0.5 ${radio.priority === 1 ? 'text-red-emergency border-red-emergency/60 bg-red-emergency/10' : 'text-amber-gold border-amber-gold/60 bg-amber-gold/10'}`}>
                    P{radio.priority}
                  </span>
                )}
                <div className="flex items-center gap-1.5 bg-red-emergency/20 border border-red-emergency/30 px-1.5 py-0.5 rounded-full">
                  <span className="w-1 h-1 rounded-full bg-red-emergency animate-pulse" aria-hidden="true" />
                  <span className="font-mono text-[11px] text-red-emergency uppercase font-bold">LIVE</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Middle Section — Playback Controls */}
        <div className="lg:absolute lg:left-1/2 lg:-translate-x-1/2 flex items-center gap-3 shrink-0 h-full">
          <button
            onClick={() => skipChannel(-1)}
            disabled={liveMode || visibleTalkgroups.length === 0}
            className="hidden lg:flex text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-none disabled:opacity-30"
            aria-label="Previous channel"
          >
            <span className="ms text-[18px]">skip_previous</span>
          </button>

          <button
            onClick={toggle}
            disabled={loading}
            className={`w-10 h-10 rounded-full border border-amber-gold flex items-center justify-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${loading ? 'bg-amber-gold-muted text-onyx-black cursor-wait opacity-80' : playing ? 'bg-amber-gold text-onyx-black hover:bg-amber-400 hover:scale-105 shadow-[0_0_20px_rgba(255,184,0,0.4)]' : 'text-amber-gold hover:bg-amber-gold/10'}`}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            <span className="ms text-[24px] leading-none ml-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>
              {playing ? 'pause' : 'play_arrow'}
            </span>
          </button>

          <button
            onClick={() => (liveMode ? playerRef.current!.skip() : skipChannel(1))}
            disabled={liveMode ? !liveCall : visibleTalkgroups.length === 0}
            className="hidden lg:flex text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-none disabled:opacity-30"
            aria-label={liveMode ? 'Skip this call' : 'Next channel'}
          >
            <span className="ms text-[18px]">skip_next</span>
          </button>
        </div>

        {/* Right Section */}
        <div className="flex lg:flex-1 items-center justify-end gap-3 lg:gap-5 min-w-0 ml-3 lg:ml-[180px]">
          <div className="hidden lg:flex items-center">
            <span className="font-mono text-[11px] text-amber-gold w-14 tracking-wider text-right font-semibold">
              {playing ? formatElapsed(elapsed) : '00:00:00'}
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-2">
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
            aria-label="Channels"
            className={`flex items-center gap-1.5 px-3 py-2 lg:py-1.5 lg:rounded-full border border-amber-gold/30 text-[11px] font-bold tracking-widest uppercase transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${showChannels ? 'bg-amber-gold text-onyx-black border-amber-gold' : 'text-amber-gold hover:bg-amber-gold/10 hover:border-amber-gold/50'}`}
          >
            <span className="ms text-[14px] leading-none">format_list_bulleted</span>
            <span className="hidden md:inline text-[11px]">CHANNELS</span>
          </button>
        </div>
      </div>
      <audio ref={audioRef} preload="none" className="hidden" aria-hidden="true" />
    </aside>
  )
}
