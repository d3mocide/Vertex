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


export function TacticalAudio() {
  const audioRef   = useRef<HTMLAudioElement>(null)
  const [playing,  setPlaying]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [volume,   setVolume]   = useState(0.7)
  const [elapsed,  setElapsed]  = useState(0)
  const [showChannels, setShowChannels] = useState(false)
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
        absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col justify-end items-end w-[840px] max-w-[95vw] pointer-events-none transition-all duration-300
        ${isCritical ? 'scale-105 origin-bottom' : 'scale-100 origin-bottom'}
      `}
      aria-label="Tactical audio console"
    >
      {/* Pop-up Talkgroups List */}
      {showChannels && (
        <div className="hud-panel w-64 mb-4 rounded-xl overflow-hidden pointer-events-auto origin-bottom-right animate-in fade-in slide-in-from-bottom-2 duration-200">
           <div className="px-4 py-2 border-b border-amber-gold-muted/30">
             <span className="label-caps">TALKGROUPS</span>
           </div>
           <nav className="max-h-60 overflow-y-auto">
             {TALKGROUP_CHANNELS.map((ch) => {
               const isCurrent = radio?.tgid === ch.tgid
               return (
                 <button
                   key={ch.tgid}
                   className={`
                     w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold
                     ${isCurrent ? 'bg-amber-gold-muted/30 text-amber-gold border-l-2 border-amber-gold' : 'text-on-surface-variant hover:bg-surface-container border-l-2 border-transparent'}
                   `}
                 >
                   <span className="ms text-[18px] leading-none" aria-hidden="true">radio</span>
                   <div className="flex-1 min-w-0">
                     <div className="text-[10px] font-bold tracking-widest uppercase truncate">{ch.label}</div>
                   </div>
                   <div className="font-mono text-[9px] opacity-60 ml-auto">{ch.tgid}</div>
                 </button>
               )
             })}
           </nav>
        </div>
      )}

      {/* Main Bottom Bar */}
      <div className="bg-white/[0.03] border border-white/10 backdrop-blur-md rounded-full h-12 w-full flex items-center px-4 md:px-5 pointer-events-auto relative shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        
        {/* Left Section (Info) */}
        <div className="flex flex-1 items-center gap-2.5 min-w-0 mr-[140px]">
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
              <span>{radio?.tgid ? `TGID ${radio.tgid}` : 'TACTICAL AUDIO'}</span>
              {radio?.freq_hz && (
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

        {/* Middle Section (Playback Controls) - Absolutely Centered */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3 shrink-0 h-full">
          <button className="text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-none flex" aria-label="Previous channel">
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


          <button className="text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-none flex" aria-label="Next channel">
            <span className="ms text-[18px]">skip_next</span>
          </button>
        </div>


        {/* Right Section (Stats & Settings) */}
        <div className="flex flex-1 items-center justify-end gap-5 min-w-0 ml-[160px]">
          
          {/* Elapsed Time */}
          <div className="hidden sm:flex items-center">
            <span className="font-mono text-[11px] text-amber-gold w-14 tracking-wider text-right font-semibold">
               {playing ? formatElapsed(elapsed) : '00:00:00'}
            </span>
          </div>

          {/* Volume */}
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
