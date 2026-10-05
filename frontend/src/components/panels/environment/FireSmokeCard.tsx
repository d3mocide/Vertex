import { useEffect, useState } from 'react'
import { FeedAge } from '../../common/FeedAge'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'
import { useContractAvailable } from '../../../hooks/useCapabilities'
import { renderFireRow, type FirePanelEntity } from './FireStatusCard'

interface Hotspot { lat: number; lon: number; ts: string; frp: number | null; confidence: 'high' | 'nominal'; dist_km: number }
interface Zone { zone: string; danger: number; danger_rank?: number; label: string; dist_km: number; provider_id?: string; attribution?: string; burn_ban?: string; scope?: string; notes?: string }
interface Danger { home: Zone | null; nearby: Zone[] }

// Same signal colours as the map layer: green nominal, gold caution, orange serious, red extreme.
const DANGER_TONE: Record<number, string> = { 1: 'text-green-ais', 2: 'text-amber-gold', 3: 'text-amber-p25', 4: 'text-red-emergency' }

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  return m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

function Chip({ label, value, tone = 'text-on-surface', hint }: { label: string; value: string | number; tone?: string; hint?: string }) {
  return (
    <div className="border border-white/10 bg-white/2 px-3 py-2 min-w-0">
      <div className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest">{label}</div>
      <div className={`mt-1 text-[18px] font-black leading-none ${tone}`}>{value}</div>
      {hint && <div className="mt-1 font-mono text-[11px] text-on-surface-variant">{hint}</div>}
    </div>
  )
}

/**
 * Everything fire and smoke in one card: local/regional fires, regional danger, NASA
 * satellite hotspots and AQI. It is a row of four numbers when things are quiet;
 * lists appear only for the parts that have something to say.
 */
export function FireSmokeCard({ localFires, regionalFires, aqi, aqiLabel }: {
  localFires: FirePanelEntity[]
  regionalFires: FirePanelEntity[]
  aqi: number | undefined
  aqiLabel: string | undefined
}) {
  const hasFireDanger = useContractAvailable('fire.danger')
  const [spots, setSpots] = useState<Hotspot[]>([])
  const [danger, setDanger] = useState<Danger | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [h, d] = await Promise.all([
          fetch(`${API_BASE}/weather/fire/hotspots`, { headers: authHeaders() }),
          fetch(`${API_BASE}/weather/fire/danger`, { headers: authHeaders() }),
        ])
        if (h.ok) setSpots(await h.json())
        if (d.ok) setDanger(await d.json())
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 15 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const zones = danger?.nearby ?? []
  const topZone = zones.length ? zones.reduce((a, b) => ((b.danger_rank ?? (b.danger === 4 ? 5 : b.danger)) > (a.danger_rank ?? (a.danger === 4 ? 5 : a.danger)) ? b : a)) : null
  const nearestSpot = spots.length ? [...spots].sort((a, b) => a.dist_km - b.dist_km)[0] : null

  const smoke = aqi == null ? { text: '—', tone: 'text-on-surface-variant' }
    : aqi <= 50 ? { text: 'Low', tone: 'text-green-ais' }
    : aqi <= 100 ? { text: 'Watch', tone: 'text-amber-gold' }
    : { text: 'Impact', tone: 'text-red-emergency' }

  const localOpen = localFires.filter((fire) => fire.containedPct !== 100)
  const regionalOpen = regionalFires.filter((fire) => fire.containedPct !== 100)
  const containedFires = [...localFires, ...regionalFires].filter((fire) => fire.containedPct === 100)

  const nothingToList = localFires.length === 0 && regionalFires.length === 0 && spots.length === 0

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-p25" aria-hidden="true">local_fire_department</span>
        FIRE &amp; SMOKE
        <FeedAge feedKey="fire:nifc_incidents" prefix="NIFC updated" className="text-[11px]" />
        {nothingToList && <span className="ml-auto font-mono text-[11px] text-green-ais normal-case tracking-normal">Quiet</span>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Chip label="Nearby incidents" value={localOpen.length} tone={localOpen.length ? 'text-amber-gold' : 'text-on-surface'} hint="partial or unreported containment" />
        {hasFireDanger && (
          <Chip label="Fire danger" value={topZone ? topZone.label : '—'} tone={topZone ? DANGER_TONE[topZone.danger] : undefined}
            hint={topZone ? `${topZone.attribution ?? 'Regional'} · ${topZone.zone}` : undefined} />
        )}
        <Chip label="Hotspots" value={spots.length} tone={spots.length ? 'text-amber-gold' : 'text-on-surface'}
          hint={nearestSpot ? `nearest ${Math.round(nearestSpot.dist_km)} km` : 'satellite, 24 h'} />
        <Chip label="Smoke" value={smoke.text} tone={smoke.tone} hint={aqi != null ? `AQI ${aqi}` : 'no AQI'} />
      </div>

      {(localOpen.length > 0 || regionalOpen.length > 0) && (
        <div className="mt-4 stack-y-1.5">
          {localOpen.slice(0, 3).map(renderFireRow)}
          {regionalOpen.slice(0, 4).map(renderFireRow)}
        </div>
      )}

      {containedFires.length > 0 && (
        <details className="mt-4 border border-outline-variant px-3 py-2">
          <summary className="cursor-pointer font-mono text-[11px] text-on-surface-variant">
            100% contained · {containedFires.length} reported incidents
          </summary>
          <p className="mt-2 text-[11px] text-on-surface-variant">Reported containment does not establish that a fire is extinguished.</p>
          <div className="mt-2 stack-y-1.5">{containedFires.map(renderFireRow)}</div>
        </details>
      )}

      {spots.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Satellite detections · last 24 h</div>
          <div className="stack-y-1">
            {spots.slice(0, 4).map((s, i) => (
              <div key={`${s.lat}-${s.lon}-${i}`} className="flex items-center gap-3 border border-white/10 bg-white/2 px-3 py-1.5 font-mono text-[11px]">
                <span className="text-on-surface w-14">{Math.round(s.dist_km)} km</span>
                <span className="text-on-surface-variant flex-1 truncate">{s.lat.toFixed(3)}, {s.lon.toFixed(3)}</span>
                {s.frp != null && <span className="text-on-surface-variant">{Math.round(s.frp)} MW</span>}
                {s.confidence === 'high' && <span className="text-amber-gold uppercase">high</span>}
                <span className="text-on-surface-variant w-20 text-right">{ago(s.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {zones.filter((z) => z.provider_id === 'wadnr-fire-danger' && z.burn_ban).map((z) => (
        <div key={`burn-${z.zone}`} className="mt-3 border border-outline-variant px-3 py-2 text-[11px] text-on-surface-variant">
          <div className="font-mono text-on-surface">WA DNR · {z.zone}: {z.burn_ban}</div>
          <div className="mt-1">{z.scope}</div>
          {z.notes && <div className="mt-1">{z.notes}</div>}
        </div>
      ))}

      {zones.length > 1 && (
        <div className="mt-3 font-mono text-[11px] text-on-surface-variant leading-relaxed">
          <span className="uppercase tracking-widest">Danger zones </span>
          {zones.map((z, i) => (
            <span key={`${z.provider_id}-${z.zone}`}>
              {i > 0 && ' · '}
              {z.attribution ? `${z.attribution} ` : ''}{z.zone} <span className={DANGER_TONE[z.danger]}>{z.label}</span> {Math.round(z.dist_km)} km
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
