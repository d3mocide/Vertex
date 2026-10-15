import { useRef, useState } from 'react'
import { API_BASE } from '../../../config'
import { useCivicStore } from '../../../store'

const STREAM_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, '')

/** Live NOAA Weather Radio from Tocsin: play the broadcast, see the last thing the announcer said and whether the
 *  receiver hears the channel. Renders nothing unless Tocsin is configured. */
export function NwrRadioCard() {
  const status = useCivicStore((s) => s.nwr)       // polled once for the whole app (hooks/useAlerts.ts)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  if (!status?.enabled) return null

  const onAir = !!status.reachable && !!status.stream_url
  const stream = status.streams?.find((s) => s.on_air)
  const live = (status.alerts ?? []).filter((a) => !a.test)

  // The stream is only opened on demand and closed on pause, so an idle card holds no connection.
  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      el.removeAttribute('src')
      el.load()
      setPlaying(false)
      return
    }
    setFailed(false)
    el.src = `${STREAM_ORIGIN}${status.stream_url}`
    el.play().then(() => setPlaying(true)).catch(() => { setFailed(true); setPlaying(false) })
  }

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

      <div className="flex items-center gap-3 mt-3">
        <button type="button" className="btn-ghost h-9 px-3 flex items-center gap-1.5" onClick={toggle} disabled={!onAir}
                aria-label={playing ? 'Stop weather radio' : 'Play weather radio'}>
          <span className="ms text-[18px] leading-none" aria-hidden="true">{playing ? 'stop' : 'play_arrow'}</span>
          <span className="text-[11px] font-bold uppercase tracking-widest">{playing ? 'Stop' : 'Listen'}</span>
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
      {failed && <p className="mt-2 font-mono text-[11px] text-red-emergency">Stream unavailable</p>}

      {status.last_spoken?.text && (
        <div className="mt-3 border-l-2 border-outline-variant pl-3">
          <span className="label-caps">LAST BROADCAST · <span className="font-mono">{new Date(status.last_spoken.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></span>
          <p className="mt-1 text-[13px] leading-snug text-on-surface line-clamp-3">{status.last_spoken.text}</p>
        </div>
      )}
      <audio ref={audioRef} preload="none" className="hidden" aria-hidden="true"
             onEnded={() => setPlaying(false)} onError={() => { if (playing) { setFailed(true); setPlaying(false) } }} />
    </section>
  )
}
