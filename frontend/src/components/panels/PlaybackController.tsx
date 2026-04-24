import { useState, useEffect, useRef, useCallback } from 'react'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

const WINDOW_OPTIONS = [
  { label: '1 hr',  hours: 1  },
  { label: '2 hr',  hours: 2  },
  { label: '6 hr',  hours: 6  },
  { label: '12 hr', hours: 12 },
  { label: '24 hr', hours: 24 },
]
const SPEEDS = [1, 2, 5, 10]

function fmtTime(ms: number) {
  const d = new Date(ms)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDateShort(ms: number) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function PlaybackController() {
  const {
    replayMode, setReplayMode,
    replayData, setReplayData,
    replayCurrentTs, setReplayCurrentTs,
    replayPlaying, setReplayPlaying,
    replaySpeed, setReplaySpeed,
  } = useCivicStore()

  const [windowHours, setWindowHours] = useState(2)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const rafRef = useRef(0)
  const lastRealRef = useRef(0)
  const currentTsRef = useRef(replayCurrentTs)

  const startMs  = replayData ? Date.parse(replayData.start) : 0
  const endMs    = replayData ? Date.parse(replayData.end)   : 0
  const durationMs = endMs - startMs

  const entityCount = replayData ? Object.keys(replayData.entities).length : 0

  const loadReplay = useCallback(async () => {
    setLoading(true)
    setError(null)
    const end   = new Date()
    const start = new Date(end.getTime() - windowHours * 3_600_000)
    try {
      const res = await fetch(
        `${API_BASE}/observations/replay?start=${start.toISOString()}&end=${end.toISOString()}`,
        { headers: authHeaders() },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setReplayData(data)
      setReplayCurrentTs(Date.parse(data.start))
      setReplayMode(true)
      setReplayPlaying(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [windowHours, setReplayData, setReplayCurrentTs, setReplayMode, setReplayPlaying])

  const exitReplay = useCallback(() => {
    setReplayMode(false)
    setReplayData(null)
    setReplayPlaying(false)
    setReplayCurrentTs(0)
  }, [setReplayMode, setReplayData, setReplayPlaying, setReplayCurrentTs])

  // Keep ref in sync so the RAF closure always has the latest value
  useEffect(() => { currentTsRef.current = replayCurrentTs }, [replayCurrentTs])

  // Playback ticker
  useEffect(() => {
    if (!replayPlaying || !replayData) return
    const tick = (now: number) => {
      const dt = lastRealRef.current ? now - lastRealRef.current : 0
      lastRealRef.current = now
      const next = currentTsRef.current + dt * replaySpeed
      if (next >= endMs) {
        setReplayCurrentTs(endMs)
        setReplayPlaying(false)
        return
      }
      currentTsRef.current = next
      setReplayCurrentTs(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    lastRealRef.current = 0
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [replayPlaying, replayData, replaySpeed, endMs, setReplayCurrentTs, setReplayPlaying])

  return (
    <>
      {/* Trigger button — always visible on Safety tab */}
      {!replayMode && (
        <button
          onClick={() => setOpen((v) => !v)}
          className={`
            absolute bottom-16 right-4 z-30 flex items-center gap-2 px-3 py-2
            hud-panel border border-amber-gold-muted text-[10px] font-mono uppercase tracking-widest
            hover:border-amber-gold/60 transition-colors focus:outline-none
            ${open ? 'text-amber-gold border-amber-gold' : 'text-on-surface-variant'}
          `}
          aria-expanded={open}
          title="Historical playback"
        >
          <span className="ms text-[16px] leading-none">history</span>
          REPLAY
        </button>
      )}

      {/* Load panel — shown when trigger clicked and not yet in replay mode */}
      {open && !replayMode && (
        <div className="absolute bottom-28 right-4 z-30 w-64 hud-panel p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[10px] tracking-[0.2em] uppercase text-amber-gold">Load History</span>
            <button onClick={() => setOpen(false)} className="ms text-[16px] text-on-surface-variant hover:text-on-surface leading-none focus:outline-none">close</button>
          </div>

          {/* Window selector */}
          <div>
            <span className="label-caps text-[9px] block mb-2">Time window (ending now)</span>
            <div className="flex flex-wrap gap-1">
              {WINDOW_OPTIONS.map((opt) => (
                <button
                  key={opt.hours}
                  onClick={() => setWindowHours(opt.hours)}
                  className={`px-2 py-1 border text-[9px] font-mono uppercase tracking-widest transition-colors focus:outline-none ${
                    windowHours === opt.hours
                      ? 'border-amber-gold text-amber-gold bg-amber-gold/10'
                      : 'border-white/10 text-on-surface-variant hover:border-white/20'
                  }`}
                  aria-pressed={windowHours === opt.hours}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-[10px] text-red-emergency">{error}</p>
          )}

          <button
            onClick={loadReplay}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2 bg-amber-gold/10 border border-amber-gold/60 text-amber-gold text-[10px] font-bold uppercase tracking-widest hover:bg-amber-gold/20 transition-colors focus:outline-none disabled:opacity-50"
          >
            {loading
              ? <><span className="ms text-[14px] animate-spin leading-none">progress_activity</span> Loading…</>
              : <><span className="ms text-[14px] leading-none">download</span> Load</>
            }
          </button>
        </div>
      )}

      {/* Playback controls — shown when in replay mode */}
      {replayMode && replayData && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[520px] max-w-[calc(100vw-2rem)] hud-panel p-4 space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="ms text-[14px] text-amber-gold leading-none">history</span>
              <span className="font-bold text-[10px] tracking-[0.2em] uppercase text-amber-gold">REPLAY</span>
              <span className="font-mono text-[9px] text-on-surface-variant">
                {entityCount} entit{entityCount !== 1 ? 'ies' : 'y'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* Speed selector */}
              <div className="flex items-center border border-white/10 divide-x divide-white/10">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setReplaySpeed(s)}
                    className={`px-2 py-0.5 font-mono text-[9px] uppercase transition-colors focus:outline-none ${
                      replaySpeed === s ? 'bg-amber-gold text-onyx-black font-bold' : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                    aria-pressed={replaySpeed === s}
                  >
                    {s}×
                  </button>
                ))}
              </div>
              <button
                onClick={exitReplay}
                className="ms text-[16px] text-on-surface-variant hover:text-red-emergency transition-colors leading-none focus:outline-none"
                title="Exit replay"
              >
                close
              </button>
            </div>
          </div>

          {/* Scrubber */}
          <div className="relative">
            <div className="relative h-1.5 bg-surface-container rounded-full overflow-hidden">
              <div
                className="absolute left-0 top-0 bottom-0 bg-amber-gold/40 rounded-full"
                style={{ width: `${durationMs > 0 ? ((replayCurrentTs - startMs) / durationMs) * 100 : 0}%` }}
                aria-hidden="true"
              />
            </div>
            <input
              type="range"
              min={startMs}
              max={endMs}
              step={1000}
              value={replayCurrentTs}
              onChange={(e) => {
                setReplayPlaying(false)
                setReplayCurrentTs(Number(e.target.value))
              }}
              className="absolute inset-0 w-full opacity-0 cursor-pointer"
              aria-label="Playback position"
            />
          </div>

          {/* Time display + play/pause */}
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] text-on-surface-variant">
              {fmtDateShort(startMs)} {fmtTime(startMs)}
            </span>
            <div className="flex items-center gap-3">
              {/* Step back 1 min */}
              <button
                onClick={() => setReplayCurrentTs(Math.max(startMs, replayCurrentTs - 60_000))}
                className="ms text-[18px] text-on-surface-variant hover:text-on-surface transition-colors leading-none focus:outline-none"
                title="Back 1 min"
              >
                replay_10
              </button>
              {/* Play / Pause */}
              <button
                onClick={() => setReplayPlaying(!replayPlaying)}
                className="ms text-[24px] text-amber-gold hover:text-amber-gold/80 transition-colors leading-none focus:outline-none"
                aria-label={replayPlaying ? 'Pause' : 'Play'}
              >
                {replayPlaying ? 'pause_circle' : 'play_circle'}
              </button>
              {/* Step forward 1 min */}
              <button
                onClick={() => setReplayCurrentTs(Math.min(endMs, replayCurrentTs + 60_000))}
                className="ms text-[18px] text-on-surface-variant hover:text-on-surface transition-colors leading-none focus:outline-none"
                title="Forward 1 min"
              >
                forward_10
              </button>
            </div>
            <span className="font-mono text-[9px] text-on-surface-variant">
              {fmtDateShort(endMs)} {fmtTime(endMs)}
            </span>
          </div>

          {/* Current time indicator */}
          <div className="text-center font-mono text-[11px] text-amber-gold">
            {fmtDateShort(replayCurrentTs)} {fmtTime(replayCurrentTs)}
          </div>
        </div>
      )}
    </>
  )
}
