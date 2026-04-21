import { useEffect, useRef, useState } from 'react'
import { useCivicStore } from '../../store'
import { STREAM_URL } from '../../config'

const TALKGROUP_CHANNELS = [
  { tgid: 1001, label: 'Tualatin Fire Dispatch',   color: 'text-red-emergency'   },
  { tgid: 1002, label: 'Washington Co. Sheriff',   color: 'text-cyan-adsb'       },
  { tgid: 1003, label: 'Tualatin PD Ops',          color: 'text-amber-p25'       },
  { tgid: 1004, label: 'Lake Oswego Fire',          color: 'text-red-emergency'   },
  { tgid: 1005, label: 'ODOT Highway Ops',          color: 'text-green-ais'       },
]

function WaveformBars({ active }: { active: boolean }) {
  return (
    <div
      className="flex items-end justify-center gap-0.5 h-6"
      aria-hidden="true"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className={`w-1 bg-amber-gold wave-bar transition-opacity ${active ? 'opacity-80' : 'opacity-20'}`}
          style={{ height: `${[8, 16, 24, 12, 20, 16, 8, 24][i]}px` }}
        />
      ))}
    </div>
  )
}

export function TacticalAudio() {
  const audioRef   = useRef<HTMLAudioElement>(null)
  const [playing,  setPlaying]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [volume,   setVolume]   = useState(0.7)
  const [elapsed,  setElapsed]  = useState(0)
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  const radio = useCivicStore((s) => s.radio)
  const mode  = useCivicStore((s) => s.mode)

  const isActive = radio?.state === 'call'

  // Elapsed time counter
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
      el.src = STREAM_URL
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

  const activeTag = radio?.tag
    ?? TALKGROUP_CHANNELS.find((c) => c.tgid === radio?.tgid)?.label
    ?? 'SCAN'

  const formatElapsed = (s: number) => {
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `00:${mm}:${ss}`
  }

  // Critical mode: audio console is more prominent
  const isCritical = mode === 'critical'

  return (
    <aside
      className={`
        absolute bottom-6 right-6 w-80 hud-panel flex flex-col z-20 overflow-hidden
        transition-all duration-300
        ${isCritical ? 'max-h-[640px]' : 'max-h-[560px]'}
      `}
      aria-label="Tactical audio console"
    >
      {/* Console header */}
      <div className="p-4 border-b border-amber-gold-muted bg-onyx-deep/60 shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 border border-amber-gold flex items-center justify-center bg-surface-container/80 shrink-0">
            <span
              className="ms text-[20px] text-amber-gold leading-none"
              aria-hidden="true"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              cell_tower
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-sm tracking-tight text-on-surface uppercase">
              TACTICAL AUDIO
            </h2>
            <span className="font-mono text-[9px] text-amber-gold-dim block tracking-widest uppercase truncate">
              ALPHA TAG: {activeTag}
            </span>
          </div>
          {/* Live indicator */}
          {isActive && (
            <div className="ml-auto shrink-0 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-emergency animate-pulse" aria-hidden="true" />
              <span className="font-mono text-[9px] text-red-emergency uppercase font-bold">LIVE</span>
            </div>
          )}
        </div>

        {/* Play button */}
        <button
          onClick={toggle}
          disabled={loading}
          className={`
            w-full font-bold text-[11px] py-2.5 uppercase tracking-[0.2em] transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-gold
            ${loading
              ? 'bg-amber-gold-muted text-onyx-black cursor-wait'
              : playing
                ? 'bg-red-emergency text-white hover:bg-red-800'
                : 'bg-amber-gold text-onyx-black hover:bg-white'
            }
          `}
          aria-pressed={playing}
          aria-label={playing ? 'Stop P25 radio stream' : 'Start P25 radio stream'}
        >
          {loading ? 'CONNECTING…' : playing ? '■ STOP STREAM' : '▶ P25 RADIO'}
        </button>
      </div>

      {/* Channel info + player */}
      <div className="p-4 border-b border-amber-gold-muted flex flex-col gap-4 shrink-0">
        {/* Active channel */}
        <div>
          <span className="label-caps block mb-1">ACTIVE CHANNEL</span>
          <span className="font-mono text-sm text-amber-gold truncate font-bold block">{activeTag}</span>
          <div className="flex items-center gap-3 mt-2">
            {playing && (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-gold animate-pulse" aria-hidden="true" />
                <span className="font-mono text-[10px] text-amber-gold uppercase">REC</span>
              </div>
            )}
            {radio?.tgid && (
              <span className="font-mono text-[10px] text-on-surface-variant">
                TGID {radio.tgid}
              </span>
            )}
            {radio?.freq_hz && (
              <span className="font-mono text-[10px] text-on-surface-variant">
                {(radio.freq_hz / 1e6).toFixed(4)} MHz
              </span>
            )}
            {playing && (
              <span className="font-mono text-[10px] text-on-surface-variant ml-auto">
                {formatElapsed(elapsed)}
              </span>
            )}
          </div>
        </div>

        {/* Playback controls */}
        <div className="bg-surface-container/80 border border-amber-gold-muted/50 p-4 relative overflow-hidden">
          <div className="flex items-center justify-between relative z-10">
            <button
              className="text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
              aria-label="Previous channel"
            >
              <span className="ms text-[20px]">skip_previous</span>
            </button>

            <button
              onClick={toggle}
              disabled={loading}
              className="w-12 h-12 rounded-full border-2 border-amber-gold flex items-center justify-center text-amber-gold hover:bg-amber-gold hover:text-onyx-black transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-gold focus-visible:ring-offset-1 focus-visible:ring-offset-surface-container"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              <span
                className="ms text-[28px] leading-none"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {playing ? 'pause' : 'play_arrow'}
              </span>
            </button>

            <button
              className="text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
              aria-label="Next channel"
            >
              <span className="ms text-[20px]">skip_next</span>
            </button>
          </div>

          {/* Waveform */}
          <div className="mt-3">
            <WaveformBars active={playing && isActive} />
          </div>
        </div>

        {/* Volume control */}
        <div className="flex items-center gap-3 px-1">
          <span className="ms text-[18px] text-on-surface-variant" aria-hidden="true">
            {volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}
          </span>
          <label className="sr-only" htmlFor="volume-slider">Volume</label>
          <div className="flex-1 relative h-1 bg-surface-container-highest">
            <div
              className="absolute left-0 top-0 bottom-0 bg-amber-gold transition-all"
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
          <span className="font-mono text-[10px] text-on-surface-variant w-8 text-right">
            {Math.round(volume * 100)}
          </span>
        </div>
      </div>

      {/* Talkgroup list */}
      <nav
        className="flex-1 overflow-y-auto"
        aria-label="Talkgroup channels"
      >
        <div className="px-4 py-2 border-b border-amber-gold-muted/30">
          <span className="label-caps">TALKGROUPS</span>
        </div>
        {TALKGROUP_CHANNELS.map((ch) => {
          const isCurrent = radio?.tgid === ch.tgid
          return (
            <div
              key={ch.tgid}
              className={`
                px-4 py-2.5 flex items-center gap-3 text-[10px] font-bold tracking-widest uppercase
                cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold
                ${isCurrent
                  ? 'bg-amber-gold-muted/30 text-amber-gold border-l-2 border-amber-gold'
                  : 'text-on-surface-variant hover:bg-surface-container border-l-2 border-transparent'}
              `}
              role="button"
              tabIndex={0}
              aria-label={`Talkgroup ${ch.label}, ID ${ch.tgid}`}
            >
              <span className="ms text-[18px] leading-none" aria-hidden="true">radio</span>
              <span className="truncate">{ch.label}</span>
              <span className="ml-auto font-mono text-[9px] opacity-60">{ch.tgid}</span>
            </div>
          )
        })}
      </nav>

      <audio ref={audioRef} preload="none" className="hidden" aria-hidden="true" />
    </aside>
  )
}
