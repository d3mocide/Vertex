import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { MAP_STYLE } from '../config'
import {
  fetchPacks, fetchSetupStatus, resolveLocation, saveRegion, SetupError,
  type PackInfo, type ResolvedLocation, type SetupStatus,
} from '../setup'

/**
 * First-run and "change region" setup. Five steps:
 *   location -> region details -> region pack -> keys -> review and save.
 * It only ever saves through PUT /config/region; the poller applies the result when it starts (or after
 * a restart when the region changes later). The wizard never handles secrets: packs name the keys they
 * need and the operator adds them to .env.
 */

type Step = 'location' | 'region' | 'pack' | 'keys' | 'review' | 'done'
const STEPS: { id: Exclude<Step, 'done'>; label: string }[] = [
  { id: 'location', label: 'Location' },
  { id: 'region', label: 'Region' },
  { id: 'pack', label: 'Region pack' },
  { id: 'keys', label: 'Keys' },
  { id: 'review', label: 'Review' },
]
const US_CENTER: [number, number] = [-98.5, 39.5]

const input = 'w-full bg-surface-container-highest/50 border border-white/10 px-3 py-2 font-mono text-[13px] text-on-surface focus:outline-none focus:border-amber-gold'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-caps block mb-1">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-on-surface-variant">{hint}</span>}
    </label>
  )
}

/** Click-to-place map. Only the chosen coordinates leave this component. */
function LocationPicker({ lat, lon, onPick }: { lat: number | null; lon: number | null; onPick: (lat: number, lon: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  useEffect(() => {
    if (!ref.current) return
    const start: [number, number] = lat !== null && lon !== null ? [lon, lat] : US_CENTER
    const map = new maplibregl.Map({
      container: ref.current, style: MAP_STYLE, center: start,
      zoom: lat !== null ? 9 : 3, attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    // Some styles reference sprites we do not ship; a blank image keeps the console quiet.
    map.on('styleimagemissing', (e) => {
      if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) })
    })
    map.on('click', (e) => onPickRef.current(e.lngLat.lat, e.lngLat.lng))
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; markerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || lat === null || lon === null) return
    if (!markerRef.current) markerRef.current = new maplibregl.Marker({ color: '#FFB800' }).setLngLat([lon, lat]).addTo(map)
    else markerRef.current.setLngLat([lon, lat])
    map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 8), duration: 400 })
  }, [lat, lon])

  return <div ref={ref} className="w-full h-64 border border-white/10" role="application" aria-label="Map: click to choose your location" />
}

export function SetupWizard({ firstRun, onClose }: { firstRun: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>('location')
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [latText, setLatText] = useState('')
  const [lonText, setLonText] = useState('')
  const [resolved, setResolved] = useState<ResolvedLocation | null>(null)
  const [resolveNote, setResolveNote] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [radius, setRadius] = useState('60')
  const [timezone, setTimezone] = useState('')
  const [packs, setPacks] = useState<PackInfo[]>([])
  const [packIds, setPackIds] = useState<string[]>([])
  const [packSelectionLoaded, setPackSelectionLoaded] = useState(false)
  const [savedStatus, setSavedStatus] = useState<SetupStatus | null>(null)

  const lat = latText.trim() === '' || Number.isNaN(Number(latText)) ? null : Number(latText)
  const lon = lonText.trim() === '' || Number.isNaN(Number(lonText)) ? null : Number(lonText)
  const validPoint = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  const selectedPacks = packs.filter((p) => packIds.includes(p.id))
  const pack = selectedPacks.length ? {
    name: selectedPacks.map((p) => p.name).join(' + '),
    keys: [...new Map(selectedPacks.flatMap((p) => p.keys ?? []).map((k) => [k.name, k])).values()],
    feeds: {
      news: [...new Map(selectedPacks.flatMap((p) => p.feeds?.news ?? []).map((f) => [f.url, f])).values()],
      alerts: [...new Map(selectedPacks.flatMap((p) => p.feeds?.alerts ?? []).map((f) => [f.url, f])).values()],
    },
  } : null

  useEffect(() => { void fetchSetupStatus().then(setStatus).catch(() => undefined) }, [])

  const setPoint = (la: number, lo: number) => {
    setLatText(la.toFixed(4)); setLonText(lo.toFixed(4)); setResolved(null); setResolveNote(null)
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('This browser cannot share its location. Click the map or type coordinates.'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setError(null); setPoint(pos.coords.latitude, pos.coords.longitude) },
      () => setError('Location permission was not granted. Click the map or type coordinates instead.'),
      { enableHighAccuracy: false, timeout: 10000 },
    )
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e instanceof SetupError ? e.message : 'Something went wrong. Check the connection and try again.') }
    finally { setBusy(false) }
  }

  const toRegion = () => run(async () => {
    if (!validPoint) throw new SetupError('Pick a point on the map or enter a latitude and longitude.')
    let info: ResolvedLocation | null = null
    try {
      info = await resolveLocation(lat!, lon!)
      setResolveNote(null)
    } catch (e) {
      // Outside the US (or NWS unreachable) the wizard still works: the operator fills in the details.
      setResolveNote(e instanceof SetupError ? e.message : 'The National Weather Service could not be reached.')
    }
    setResolved(info)
    setName((n) => n || info?.suggested_name || '')
    setTimezone((t) => t || info?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '')
    setRadius(String(info?.radius_km ?? 60))
    setStep('region')
  })

  const toPack = () => run(async () => {
    if (!name.trim()) throw new SetupError('Give the region a name.')
    if (!timezone.trim()) throw new SetupError('Enter an IANA timezone such as America/Denver.')
    const r = Number(radius)
    if (!(r >= 5 && r <= 500)) throw new SetupError('Radius must be between 5 and 500 km.')
    const list = await fetchPacks(lat!, lon!, resolved?.state, Number(radius))
    setPacks(list)
    if (!packSelectionLoaded) {
      setPackIds(list.filter((p) => p.suggested && p.valid).map((p) => p.id))
      setPackSelectionLoaded(true)
    }
    setStep('pack')
  })

  const recheckKeys = () => run(async () => { setPacks(await fetchPacks(lat!, lon!, resolved?.state, Number(radius))) })

  const save = () => run(async () => {
    await saveRegion({
      name: name.trim(), lat: lat!, lon: lon!, radius_km: Number(radius), timezone: timezone.trim(),
      nws: resolved ? Object.fromEntries(Object.entries({
        office: resolved.office, forecast_zone: resolved.forecast_zone,
        county_zone: resolved.county_zone, fire_zone: resolved.fire_zone,
      }).filter(([, v]) => v)) as Record<string, string> : undefined,
      packs: packIds,
    })
    setSavedStatus(await fetchSetupStatus())
    setStep('done')
  })

  const stepIndex = STEPS.findIndex((s) => s.id === step)
  const missingKeys = useMemo(() => (pack?.keys ?? []).filter((k) => !k.present), [pack])

  const nav = (back: Step | null, next: (() => void) | null, nextLabel = 'Continue') => (
    <div className="flex items-center justify-between pt-4 border-t border-white/10">
      {back ? <button className="btn-ghost" onClick={() => { setError(null); setStep(back) }} disabled={busy}>Back</button> : <span />}
      {next && <button className="btn-primary" onClick={next} disabled={busy}>{busy ? 'Working…' : nextLabel}</button>}
    </div>
  )

  return (
    <div className="fixed inset-0 z-[70] bg-onyx-black/95 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Setup wizard">
      <div className="max-w-3xl mx-auto p-4 lg:p-8 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="label-caps text-amber-gold">{firstRun ? 'First-run setup' : 'Region setup'}</div>
            <h1 className="text-xl font-bold text-on-surface mt-1">Where are you?</h1>
            <p className="text-[13px] text-on-surface-variant mt-1">
              Vertex centers itself on your location and turns on the regional data sources that cover it.
            </p>
          </div>
          {!firstRun && step !== 'done' && <button className="btn-ghost" onClick={onClose}>Close</button>}
        </header>

        {step !== 'done' && (
          <ol className="flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-widest" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s.id} className={i === stepIndex ? 'text-amber-gold' : i < stepIndex ? 'text-on-surface' : 'text-on-surface-variant'}>
                {i + 1}. {s.label}{i < STEPS.length - 1 ? ' ›' : ''}
              </li>
            ))}
          </ol>
        )}

        {status?.locked && (
          <div className="hud-panel p-4 border border-amber-gold/40 text-[13px]" role="alert">
            <strong className="text-amber-gold">The region is pinned by your .env</strong> ({status.locked_by.join(', ')}). You can walk
            through the wizard, but saving is refused until you remove those variables and restart.
          </div>
        )}
        {error && <div className="hud-panel p-3 border border-red-emergency/60 text-[13px] text-red-emergency" role="alert">{error}</div>}

        {step === 'location' && (
          <section className="hud-panel p-4 space-y-4">
            <LocationPicker lat={validPoint ? lat : null} lon={validPoint ? lon : null} onPick={setPoint} />
            <p className="text-[12px] text-on-surface-variant">Click the map, use your device location, or type coordinates. Your coordinates stay on your own server.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude"><input className={input} inputMode="decimal" value={latText} onChange={(e) => { setLatText(e.target.value); setResolved(null) }} placeholder="39.7392" /></Field>
              <Field label="Longitude"><input className={input} inputMode="decimal" value={lonText} onChange={(e) => { setLonText(e.target.value); setResolved(null) }} placeholder="-104.9903" /></Field>
            </div>
            <button className="btn-ghost" onClick={useMyLocation} disabled={busy}>Use my location</button>
            {nav(null, toRegion)}
          </section>
        )}

        {step === 'region' && (
          <section className="hud-panel p-4 space-y-4">
            {resolved ? (
              <p className="text-[13px] text-on-surface-variant">
                The National Weather Service places this in <strong className="text-on-surface">{resolved.city}, {resolved.state}</strong> —
                forecast office <span className="font-mono text-on-surface">{resolved.office}</span>, zone{' '}
                <span className="font-mono text-on-surface">{resolved.forecast_zone}</span>. Adjust anything below.
              </p>
            ) : (
              <p className="text-[13px] text-on-surface-variant">{resolveNote ?? 'Could not look this location up.'} Enter the details yourself.</p>
            )}
            <Field label="Region name" hint="Shown in page headers."><input className={input} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Radius (km)" hint="How far from the center to watch. 60 is a metro area."><input className={input} inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} /></Field>
              <Field label="Timezone" hint="IANA name, for local times in briefings."><input className={input} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Denver" /></Field>
            </div>
            {nav('location', toPack)}
          </section>
        )}

        {step === 'pack' && (
          <section className="space-y-3">
            <p className="text-[13px] text-on-surface-variant">
              Select one or more packs for your monitored area. Border regions can use Oregon and Washington together. Packs add road conditions, outages, and similar local data. Weather, aircraft, vessels, earthquakes and other national feeds work everywhere.
            </p>
            {packs.map((p) => (
              <label key={p.id} className={`hud-panel p-4 block cursor-pointer ${!p.valid ? 'opacity-50 cursor-not-allowed' : packIds.includes(p.id) ? 'border border-amber-gold' : ''}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 accent-amber-gold" disabled={!p.valid} checked={packIds.includes(p.id)} onChange={() => setPackIds((ids) => ids.includes(p.id) ? ids.filter((id) => id !== p.id) : [...ids, p.id])} />
                  <div className="min-w-0 space-y-1">
                    <div className="font-bold text-on-surface">
                      {p.name}
                      {p.suggested && <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-green-ais">covers your monitored area</span>}
                    </div>
                    {p.valid ? (
                      <>
                        {p.description && <div className="text-[12px] text-on-surface-variant">{p.description}</div>}
                        {!!p.provides?.length && <div className="text-[12px] text-on-surface-variant">Turns on: {p.provides.map((c) => c.title).join(', ')}</div>}
                      </>
                    ) : <div className="text-[12px] text-red-emergency">Not usable: {p.error}</div>}
                  </div>
                </div>
              </label>
            ))}
            <label className={`hud-panel p-4 block cursor-pointer ${packIds.length === 0 ? 'border border-amber-gold' : ''}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 accent-amber-gold" checked={packIds.length === 0} onChange={() => setPackIds([])} />
                <div>
                  <div className="font-bold text-on-surface">Core feeds only</div>
                  <div className="text-[12px] text-on-surface-variant">No regional pack. Local road, camera and outage cards stay hidden. You can add a pack later.</div>
                </div>
              </div>
            </label>
            {!packs.some((p) => p.suggested && p.valid) && (
              <p className="text-[12px] text-on-surface-variant">No installed pack covers this location yet. Packs are contributed by the community — see the region packs guide in the documentation.</p>
            )}
            {nav('region', () => setStep('keys'))}
          </section>
        )}

        {step === 'keys' && (
          <section className="hud-panel p-4 space-y-4">
            {pack && pack.keys?.length ? (
              <>
                <p className="text-[13px] text-on-surface-variant">
                  The {pack.name} selection uses these API keys. Keys are never stored in the app: add each one to your <code className="font-mono">.env</code> file and restart the backend and poller.
                </p>
                <ul className="space-y-2">
                  {pack.keys.map((k) => (
                    <li key={k.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-white/10 p-3">
                      <code className="font-mono text-[13px] text-amber-gold">{k.name}</code>
                      <span className={`font-mono text-[11px] uppercase tracking-widest ${k.present ? 'text-green-ais' : 'text-amber-gold'}`}>{k.present ? 'found' : 'missing'}</span>
                      {k.free && <span className="text-[11px] text-on-surface-variant">free</span>}
                      {k.where && <a className="text-[12px] text-amber-gold underline" href={k.where} target="_blank" rel="noreferrer">get a key</a>}
                    </li>
                  ))}
                </ul>
                {missingKeys.length > 0 && <p className="text-[12px] text-on-surface-variant">You can finish setup now; the features that need a missing key stay off until it is added.</p>}
                <button className="btn-ghost" onClick={recheckKeys} disabled={busy}>Check again</button>
              </>
            ) : (
              <p className="text-[13px] text-on-surface-variant">{pack ? `The ${pack.name} pack needs no keys.` : 'Core feeds need no extra keys.'} Nothing to do here.</p>
            )}
            {nav('pack', () => setStep('review'))}
          </section>
        )}

        {step === 'review' && (
          <section className="hud-panel p-4 space-y-4">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-[13px]">
              <dt className="label-caps">Region</dt><dd className="text-on-surface">{name}</dd>
              <dt className="label-caps">Center</dt><dd className="font-mono text-on-surface">{lat?.toFixed(4)}, {lon?.toFixed(4)}</dd>
              <dt className="label-caps">Radius</dt><dd className="font-mono text-on-surface">{radius} km</dd>
              <dt className="label-caps">Timezone</dt><dd className="font-mono text-on-surface">{timezone}</dd>
              <dt className="label-caps">Weather office</dt><dd className="font-mono text-on-surface">{resolved?.office ?? '—'}</dd>
              <dt className="label-caps">Region packs</dt><dd className="text-on-surface">{pack ? pack.name : 'Core feeds only'}</dd>
              {!!pack?.feeds?.news.length && <><dt className="label-caps">News feeds</dt><dd className="text-on-surface">{pack.feeds.news.map((f) => f.name).join(', ')}</dd></>}
              {!!pack?.feeds?.alerts.length && <><dt className="label-caps">Emergency feeds</dt><dd className="text-on-surface">{pack.feeds.alerts.map((f) => f.name).join(', ')}</dd></>}
            </dl>
            {pack && <p className="text-[12px] text-on-surface-variant">Pack feeds are defaults. Existing feeds and disabled settings are kept. Changing packs removes only the previous pack's feeds.</p>}
            {nav('keys', save, 'Save and finish')}
          </section>
        )}

        {step === 'done' && (
          <section className="hud-panel p-6 space-y-4">
            <div className="flex items-center gap-2 text-green-ais"><span className="ms" aria-hidden="true">check_circle</span><strong>Region saved</strong></div>
            {savedStatus?.poller.state === 'waiting' && <p className="text-[13px] text-on-surface-variant">The poller was waiting for this and will start collecting data within a few seconds.</p>}
            {savedStatus?.restart_required && (
              <p className="text-[13px] text-on-surface-variant">
                The poller is still using the previous region. Restart it to apply the change:{' '}
                <code className="font-mono text-amber-gold">docker compose restart poller</code>
              </p>
            )}
            {missingKeys.length > 0 && <p className="text-[13px] text-on-surface-variant">Remember to add {missingKeys.map((k) => k.name).join(', ')} to <code className="font-mono">.env</code> and restart the backend and poller.</p>}
            <button className="btn-primary" onClick={() => window.location.reload()}>Open Vertex</button>
          </section>
        )}
      </div>
    </div>
  )
}
