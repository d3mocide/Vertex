import { useEffect, useRef, useState } from 'react'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'
import { useRadioStreams } from '../../hooks/useRadioStreams'
import { ChannelsPanel, type TalkgroupLogRow, type ManagedTalkgroup } from './ChannelsPanel'

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

  const { selectedStream, setSelectedId } = useRadioStreams()
  const radio = useCivicStore((s) => s.radio)
  const mode  = useCivicStore((s) => s.mode)

  const isActive = radio?.state === 'call'
  // Use backend proxy endpoint for all streams (handles private network IPs)
  const activeStreamUrl = selectedStream?.id ? `${API_BASE}/radio/proxy/${selectedStream.id}` : ''

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
      stopDriftCorrection()
      clearStallTimer()
      setPlaying(false)
    } else {
      setLoading(true)
      el.src = activeStreamUrl
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
  }

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (audioRef.current) audioRef.current.volume = v
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
      clearStallTimer()
      stopDriftCorrection()
      setPlaying(false)
      setLoading(false)
    }

    const onStall = () => {
      if (!playing) return
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
      className={`absolute bottom-5 lg:bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col justify-end items-end w-[1040px] max-w-[98vw] pointer-events-none transition-all duration-300 ${isCritical ? 'scale-105 origin-bottom' : 'scale-100 origin-bottom'}`}
      aria-label="Tactical audio console"
    >
      {/* Pop-up Channels Panel */}
      {showChannels && (
        <ChannelsPanel
          visibleTalkgroups={visibleTalkgroups}
          managedTalkgroups={managedTalkgroups}
          playing={playing}
          onReload={loadManagedTalkgroups}
        />
      )}

      {/* Main Bottom Bar */}
      <div className="bg-white/[0.03] border border-white/10 backdrop-blur-md rounded-full h-12 w-full flex items-center px-4 md:px-5 pointer-events-auto relative shadow-[0_8px_32px_rgba(0,0,0,0.4)]">

        {/* Left Section */}
        <div className="flex flex-1 items-center gap-2 min-w-0 mr-[78px] sm:mr-[110px] md:mr-[120px] lg:mr-[150px]">
          <div className="w-8 h-8 rounded-full border border-amber-gold/30 flex items-center justify-center bg-black/40 shrink-0">
            <span className="ms text-[18px] text-amber-gold leading-none" aria-hidden="true" style={{ fontVariationSettings: "'FILL' 1" }}>cell_tower</span>
          </div>
          <div className="min-w-0 flex items-center gap-2 sm:gap-2.5">
            <h2 className="font-bold text-[11px] sm:text-[11px] tracking-tight text-on-surface uppercase truncate">{activeTag}</h2>
            <div className="hidden sm:block w-px h-3 bg-white/10 shrink-0" />
            <div className="hidden sm:flex items-center gap-2 font-mono text-[11px] text-on-surface-variant truncate">
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
            className={`w-10 h-10 rounded-full border border-amber-gold flex items-center justify-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${loading ? 'bg-amber-gold-muted text-onyx-black cursor-wait opacity-80' : playing ? 'bg-amber-gold text-onyx-black hover:bg-amber-400 hover:scale-105 shadow-[0_0_20px_rgba(255,184,0,0.4)]' : 'text-amber-gold hover:bg-amber-gold/10'}`}
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
        <div className="flex flex-1 items-center justify-end gap-3 sm:gap-5 min-w-0 ml-[86px] sm:ml-[120px] md:ml-[140px] lg:ml-[180px]">
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-gold/30 text-[11px] font-bold tracking-widest uppercase transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${showChannels ? 'bg-amber-gold text-onyx-black border-amber-gold' : 'text-amber-gold hover:bg-amber-gold/10 hover:border-amber-gold/50'}`}
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
