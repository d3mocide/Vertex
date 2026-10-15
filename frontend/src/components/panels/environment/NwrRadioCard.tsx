import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../../../config'
import { useCivicStore } from '../../../store'

const STREAM_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, '')

/** Live NOAA Weather Radio from Tocsin: play the broadcast, see the last thing the announcer said and whether the
 *  receiver hears the channel. Renders nothing unless Tocsin is configured. */
const MAX_RETRIES = 5
const RETRY_MS = 3000

type Phase = 'idle' | 'connecting' | 'playing' | 'retry' | 'failed'

export function NwrRadioCard() {
  const status = useCivicStore((s) => s.nwr)       // polled once for the whole app (hooks/useAlerts.ts)
  const [listening, setListening] = useState(false)      // what the listener asked for
  const [phase, setPhase] = useState<Phase>('idle')         // what the audio element is actually doing
  const [failMessage, setFailMessage] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const wantRef = useRef(false)
  const retriesRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamUrl = status?.stream_url ?? null

  // The stream is only opened on demand and fully closed on stop, so an idle card holds no connection.
  const close = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    const el = audioRef.current
    if (!el) return
    el.pause()
    el.removeAttribute('src')
    el.load()
  }

  const open = () => {
    const el = audioRef.current
    if (!el || !streamUrl) return
    el.src = `${STREAM_ORIGIN}${streamUrl}?t=${Date.now()}`     // a fresh connection each time, never a cached one
    setPhase(retriesRef.current ? 'retry' : 'connecting')
    el.play().catch(() => { /* a real failure arrives as the element's own error event */ })
  }

  const giveUp = (message: string) => {
    wantRef.current = false
    close()
    setListening(false)
    setFailMessage(message)
    setPhase('failed')
  }

  // The element reports the stream ended or broke (Tocsin or Icecast restarted, a network blip): reconnect a few times.
  const lost = () => {
    const el = audioRef.current
    if (!wantRef.current || !el?.getAttribute('src')) return   // we closed it ourselves: not an error
    if (el.error?.code === 4) { giveUp("This browser can't play the Ogg stream"); return }
    close()
    if (retriesRef.current >= MAX_RETRIES) { giveUp('Stream unavailable'); return }
    retriesRef.current += 1
    setPhase('retry')
    timerRef.current = setTimeout(open, RETRY_MS)
  }

  const toggle = () => {
    if (wantRef.current) {
      wantRef.current = false
      retriesRef.current = 0
      close()
      setListening(false)
      setPhase('idle')
      return
    }
    wantRef.current = true
    retriesRef.current = 0
    setFailMessage('')
    setListening(true)
    open()
  }

  useEffect(() => () => { wantRef.current = false; close() }, [])   // leaving the page stops the stream

  if (!status?.enabled) return null

  const onAir = !!status.reachable && !!status.stream_url
  const stream = status.streams?.find((s) => s.on_air)
  const live = (status.alerts ?? []).filter((a) => !a.test)
  const spoken = status.recent_spoken?.length ? status.recent_spoken : status.last_spoken ? [status.last_spoken] : []

  return (
    <section className="hud-panel bg-onyx-deep/40 p-4" aria-label="NOAA Weather Radio">
      <div className="flex items-center gap-2">
        <span className="ms text-[16px] leading-none text-sky-400" aria-hidden="true">cell_tower</span>
        <span className="label-caps">NOAA WEATHER RADIO</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${onAir ? 'bg-green-ais' : 'bg-on-surface-variant'}`} aria-hidden="true" />
          <span className="status-pill text-on-surface-variant">{status.reachable ? (onAir ? 'ON AIR' : 'NO SIGNAL') : 'OFFLINE'}</span>
        </span>
      </div>

      {(status.notices ?? []).map((n) => (
        <div key={n.id} className="mt-3 border border-amber-gold/50 bg-amber-gold/10 px-3 py-2" role="status">
          <div className="flex items-center gap-2">
            <span className="ms text-[16px] leading-none text-amber-gold" aria-hidden="true">campaign</span>
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-gold">{n.title}</span>
            <span className="ml-auto font-mono text-[11px] text-on-surface-variant">
              on air since {new Date(n.first_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-snug text-on-surface">{n.text.slice(n.title.length).replace(/^[. ]+/, '')}</p>
          <p className="mt-1 text-[11px] text-on-surface-variant">Read by the forecaster on the broadcast; not an NWS alert.</p>
        </div>
      ))}

      <div className="flex items-center gap-3 mt-3">
        <button type="button" className="btn-ghost h-9 px-3 flex items-center gap-1.5" onClick={toggle} disabled={!listening && !onAir}
                aria-label={listening ? 'Stop weather radio' : 'Play weather radio'}>
          <span className="ms text-[18px] leading-none" aria-hidden="true">{listening ? 'stop' : 'play_arrow'}</span>
          <span className="text-[11px] font-bold uppercase tracking-widest">{listening ? 'Stop' : 'Listen'}</span>
        </button>
        <div className="flex flex-col min-w-0">
          <span className="font-mono text-[11px] text-on-surface">
            {stream ? `${stream.site} ${stream.channel}` : '—'}
            {stream && stream.listeners > 0 ? ` · ${stream.listeners} listening` : ''}
          </span>
          <span className="font-mono text-[11px] text-on-surface-variant">
            {live.length ? `${live.length} active alert${live.length === 1 ? '' : 's'}` : 'No active alerts'}
            {status.channels_dead?.length ? ` · ${status.channels_dead.length} channel${status.channels_dead.length === 1 ? '' : 's'} dead` : ''}
          </span>
        </div>
      </div>
      {phase === 'failed' && <p className="mt-2 font-mono text-[11px] text-red-emergency" role="alert">{failMessage}</p>}
      {(phase === 'connecting' || phase === 'retry') && (
        <p className="mt-2 font-mono text-[11px] text-on-surface-variant" aria-live="polite">
          {phase === 'retry' ? `Reconnecting… (${retriesRef.current}/${MAX_RETRIES})` : 'Connecting…'}
        </p>
      )}

      {spoken.length > 0 && (
        <div className="mt-3 border-l-2 border-outline-variant pl-3">
          <span className="label-caps">BROADCAST TRANSCRIPT</span>
          <ol className="mt-2 max-h-64 overflow-y-auto custom-scrollbar flex flex-col gap-2.5 pr-1" aria-label="Recent weather radio broadcast">
            {spoken.map((chunk, i) => (
              <li key={chunk.at} className={i === 0 ? '' : 'opacity-70'}>
                <span className="font-mono text-[11px] text-on-surface-variant">
                  {new Date(chunk.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <p className="text-[13px] leading-snug text-on-surface">{chunk.text}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
      <audio ref={audioRef} preload="none" className="hidden" aria-hidden="true"
             onPlaying={() => { retriesRef.current = 0; setPhase('playing') }}
             onError={lost} onEnded={lost} />
    </section>
  )
}
