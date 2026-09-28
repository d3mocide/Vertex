import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicPick } from '../../store'
import type { RadioIncident, RadioIncidentCategory } from '../../storeTypes'
import { MAP_STYLE, DEFAULT_CENTER } from '../../config'
import { ensureKnownStyleImages, KNOWN_STYLE_IMAGE_FALLBACKS } from '../Map'
import { ChipRow, Chip, EmptyState } from '../common/Page'

// ─── Classification metadata ─────────────────────────────────────────────────

type Group = 'life' | 'fire' | 'hazard' | 'traffic' | 'medical' | 'other'

const CATEGORY: Record<RadioIncidentCategory, { label: string; icon: string; group: Group }> = {
  water_rescue:        { label: 'Water / bridge rescue', icon: 'pool',                  group: 'life' },
  rescue:              { label: 'Rescue',                icon: 'support',               group: 'life' },
  violence:            { label: 'Shooting / stabbing',   icon: 'gpp_bad',               group: 'life' },
  train_or_ped_struck: { label: 'Person struck',         icon: 'directions_walk',       group: 'life' },
  structure_fire:      { label: 'Structure fire',        icon: 'local_fire_department', group: 'fire' },
  outside_fire:        { label: 'Outside / brush fire',  icon: 'local_fire_department', group: 'fire' },
  vehicle_fire:        { label: 'Vehicle fire',          icon: 'local_fire_department', group: 'fire' },
  fire:                { label: 'Fire',                  icon: 'local_fire_department', group: 'fire' },
  fire_alarm:          { label: 'Fire alarm',            icon: 'notifications_active',  group: 'fire' },
  gas_leak:            { label: 'Gas leak',              icon: 'gas_meter',             group: 'hazard' },
  carbon_monoxide:     { label: 'Carbon monoxide',       icon: 'air',                   group: 'hazard' },
  hazmat:              { label: 'Hazmat / spill',        icon: 'science',               group: 'hazard' },
  crash:               { label: 'Traffic crash',         icon: 'car_crash',             group: 'traffic' },
  assault:             { label: 'Assault',               icon: 'personal_injury',       group: 'medical' },
  medical:             { label: 'Medical',               icon: 'emergency',             group: 'medical' },
  other:               { label: 'Other',                 icon: 'radio',                 group: 'other' },
}

const FILTERS: { id: Group | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'life', label: 'Life safety' },
  { id: 'fire', label: 'Fire' },
  { id: 'hazard', label: 'Hazards' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'medical', label: 'Medical' },
]

// Radio incidents with no traffic for this long are shown as likely resolved
// (dispatch rarely broadcasts an explicit clear) — matches the AI briefing.
const STALE_MS = 3 * 60 * 60 * 1000

// Map pin colours — severity signal (red = life safety, amber = serious).
const PIN = { critical: '#C62828', serious: '#FFB800', routine: '#8C8C8C' }

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

export function isActive(i: RadioIncident, now: number): boolean {
  return i.status !== 'cleared' && now - Date.parse(i.last_seen) <= STALE_MS
}

function statusText(i: RadioIncident, now: number): string {
  if (i.status === 'cleared') return 'Cleared'
  if (i.status === 'contained') return 'Contained'
  const quietH = Math.floor((now - Date.parse(i.last_seen)) / 3_600_000)
  if (quietH >= 3) return `No update ${quietH}h`
  return i.status === 'on_scene' ? 'On scene' : 'Active'
}

function severityBar(sev: number): string {
  if (sev >= 5) return 'bg-red-emergency'
  if (sev >= 4) return 'bg-amber-gold'
  return 'bg-outline-variant'
}

/** Extractor landmarks ("bridge (landmark)") -> readable text. */
function displayLocation(loc: string | null): string | null {
  if (!loc) return null
  const m = loc.match(/^(.*) \(landmark\)$/)
  if (!m) return loc
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return `${name} — exact location not stated`
}

/** "Tualatin (area)" -> "Tualatin"; zone labels come from poller geo_tags. */
const zoneName = (tag: string) => tag.replace(/ \([a-z]+\)$/, '')

// ─── Map ─────────────────────────────────────────────────────────────────────

function IncidentMap({ incidents, selectedId, onSelect }: {
  incidents: RadioIncident[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const fitted = useRef(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!containerRef.current) return
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: 9,
      attributionControl: false,
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    // Same basemap sprite fallbacks as the main map, to avoid missing-image noise.
    m.on('styledata', () => { if (m.isStyleLoaded()) void ensureKnownStyleImages(m) })
    m.on('styleimagemissing', (e) => {
      if (m.hasImage(e.id)) return
      const make = KNOWN_STYLE_IMAGE_FALLBACKS[e.id]
      m.addImage(e.id, make ? make() : { width: 1, height: 1, data: new Uint8Array(4) })
    })
    m.on('load', () => {
      m.getCanvas().style.filter = 'brightness(0.75) contrast(1.05)'
      m.addSource('ri', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'ri-selected', type: 'circle', source: 'ri',
        filter: ['==', ['get', 'selected'], true],
        paint: { 'circle-radius': 13, 'circle-color': 'transparent', 'circle-stroke-color': '#F2F2F2', 'circle-stroke-width': 2 },
      })
      m.addLayer({
        id: 'ri-dot', type: 'circle', source: 'ri',
        paint: {
          'circle-radius': ['case', ['>=', ['get', 'severity'], 5], 8, ['>=', ['get', 'severity'], 4], 7, 5],
          'circle-color': ['case',
            ['>=', ['get', 'severity'], 5], PIN.critical,
            ['>=', ['get', 'severity'], 4], PIN.serious,
            PIN.routine],
          'circle-opacity': ['case', ['get', 'active'], 0.95, 0.45],
          'circle-stroke-color': '#050505',
          'circle-stroke-width': 1,
        },
      })
      m.on('click', 'ri-dot', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (typeof id === 'string') onSelectRef.current(id)
      })
      m.on('mouseenter', 'ri-dot', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'ri-dot', () => { m.getCanvas().style.cursor = '' })
      mapRef.current = m
      setReady(true)
    })
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(containerRef.current)
    return () => {
      ro.disconnect()
      mapRef.current = null
      setReady(false)
      m.remove()
    }
  }, [])

  const located = useMemo(() => incidents.filter((i) => i.lat != null && i.lon != null), [incidents])

  useEffect(() => {
    const m = mapRef.current
    if (!m || !ready) return
    const now = Date.now()
    ;(m.getSource('ri') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: located.map((i) => ({
        type: 'Feature',
        properties: { id: i.id, severity: i.severity, active: isActive(i, now), selected: i.id === selectedId },
        geometry: { type: 'Point', coordinates: [i.lon as number, i.lat as number] },
      })),
    })
    if (!fitted.current && located.length > 1) {
      const lons = located.map((i) => i.lon as number)
      const lats = located.map((i) => i.lat as number)
      m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: 40, maxZoom: 12, animate: false })
      fitted.current = true
    }
  }, [ready, located, selectedId])

  useEffect(() => {
    const m = mapRef.current
    const sel = located.find((i) => i.id === selectedId)
    if (m && ready && sel) m.flyTo({ center: [sel.lon as number, sel.lat as number], zoom: Math.max(m.getZoom(), 12), duration: 700 })
  }, [ready, selectedId, located])

  return (
    <div className="relative border border-white/10 bg-onyx-deep h-[320px] lg:h-[560px]">
      <div ref={containerRef} className="absolute inset-0" aria-label="Incident map" role="region" />
      <div className="absolute top-2 left-2 bg-onyx-black/80 border border-white/10 px-2 py-1 flex gap-3 text-[11px] uppercase tracking-widest text-on-surface-variant pointer-events-none">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-emergency" />Life safety</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-gold" />Serious</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-on-surface-variant" />Other</span>
      </div>
      <div className="absolute bottom-2 left-2 font-mono text-[11px] text-on-surface-variant bg-onyx-black/80 px-2 py-0.5 pointer-events-none">
        {located.length} of {incidents.length} on map
      </div>
    </div>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────

function IncidentCard({ incident: i, now, selected, onSelect }: {
  incident: RadioIncident
  now: number
  selected: boolean
  onSelect: () => void
}) {
  const meta = CATEGORY[i.category] ?? CATEGORY.other
  const active = isActive(i, now)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  return (
    <li ref={ref} className={`relative flex border bg-surface-container transition-colors ${selected ? 'border-amber-gold' : 'border-white/5 hover:border-white/15'} ${active ? '' : 'opacity-70'}`}>
      <span className={`w-1 shrink-0 ${severityBar(i.severity)}`} aria-hidden="true" />
      <div className="flex-1 min-w-0 p-3 space-y-2">
        <button onClick={onSelect} className="w-full text-left focus:outline-none" aria-pressed={selected}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`ms text-[18px] shrink-0 ${i.severity >= 5 ? 'text-red-emergency' : i.severity >= 4 ? 'text-amber-gold' : 'text-on-surface-variant'}`} aria-hidden="true">
                {meta.icon}
              </span>
              <span className="label-caps !text-on-surface truncate">{meta.label}</span>
            </div>
            <span className="font-mono text-[11px] text-on-surface-variant shrink-0">
              {hhmm(i.first_seen)}{i.last_seen !== i.first_seen && hhmm(i.last_seen) !== hhmm(i.first_seen) ? `–${hhmm(i.last_seen)}` : ''}
            </span>
          </div>
          <div className="mt-1 text-[13px] font-bold text-on-surface truncate">
            {displayLocation(i.location) ?? <span className="italic font-normal text-on-surface-variant">Location not stated</span>}
          </div>
          {i.location_heard && (
            <div className="text-[11px] text-on-surface-variant italic truncate">heard as “{i.location_heard}”</div>
          )}
        </button>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={`border px-1.5 py-0.5 uppercase tracking-widest ${active ? 'border-amber-gold/50 text-amber-gold' : 'border-white/10 text-on-surface-variant'}`}>
            {active && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-gold mr-1 align-middle animate-pulse-slow" aria-hidden="true" />}
            {statusText(i, now)}
          </span>
          <span className="font-mono text-on-surface-variant">{i.call_count} call{i.call_count === 1 ? '' : 's'}</span>
          {i.acuity && <span className="font-mono uppercase text-on-surface-variant">· {i.acuity}</span>}
          {i.units.slice(0, 5).map((u) => (
            <span key={u} className="font-mono border border-amber-p25/40 text-amber-p25 px-1 py-0.5">{u}</span>
          ))}
          {i.units.length > 5 && <span className="font-mono text-on-surface-variant">+{i.units.length - 5}</span>}
          {i.geofences.map((g) => (
            <span key={g} className="border border-outline-variant text-on-surface-variant px-1 py-0.5">{zoneName(g)}</span>
          ))}
          {i.lat == null && i.location && (
            <span className="text-on-surface-variant italic" title="Address could not be located">not mapped</span>
          )}
        </div>

        <details className="group">
          <summary className="cursor-pointer text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface list-none flex items-center gap-1">
            <span className="ms text-[14px] group-open:rotate-90 transition-transform" aria-hidden="true">chevron_right</span>
            Radio transcript
          </summary>
          <p className="mt-1 font-mono text-[11px] text-on-surface-variant leading-relaxed border-l border-amber-p25/40 pl-2">
            {i.quote}
          </p>
          <p className="mt-1 text-[11px] text-on-surface-variant italic">Automatic transcription — names and numbers may be garbled.</p>
        </details>
      </div>
    </li>
  )
}

// ─── Section ─────────────────────────────────────────────────────────────────

export function RadioIncidents() {
  const { radioIncidents } = useCivicPick('radioIncidents')
  const [filter, setFilter] = useState<Group | 'all'>('all')
  const [activeOnly, setActiveOnly] = useState(false)
  const [showRoutine, setShowRoutine] = useState(false)
  const [zone, setZone] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Phones show the list or the map, not both stacked (the map pushed the
  // list a full screen down).
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list')
  const [now, setNow] = useState(() => Date.now())

  // Re-evaluate "active"/"no update" labels every minute.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const all = radioIncidents?.incidents ?? []
  const zones = useMemo(
    () => [...new Set(all.flatMap((i) => i.geofences.filter((g) => g.endsWith('(area)')).map(zoneName)))].sort(),
    [all],
  )

  const base = useMemo(() => all.filter((i) =>
    (showRoutine || i.severity >= 3)
    && (!activeOnly || isActive(i, now))
    && (!zone || i.geofences.some((g) => zoneName(g) === zone)),
  ), [all, showRoutine, activeOnly, zone, now])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: base.length }
    for (const i of base) {
      const g = (CATEGORY[i.category] ?? CATEGORY.other).group
      c[g] = (c[g] ?? 0) + 1
    }
    return c
  }, [base])

  const shown = useMemo(() => base
    .filter((i) => filter === 'all' || (CATEGORY[i.category] ?? CATEGORY.other).group === filter)
    .sort((a, b) =>
      Number(isActive(b, now)) - Number(isActive(a, now))
      || b.severity - a.severity
      || Date.parse(b.last_seen) - Date.parse(a.last_seen)),
  [base, filter, now])

  return (
    <section className="space-y-3" aria-labelledby="radio-incidents-heading">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 id="radio-incidents-heading" className="section-heading !mb-1 flex items-center gap-2">
            <span className="ms text-[16px]" aria-hidden="true">cell_tower</span>
            Dispatch Incidents
          </h3>
          <p className="text-[12px] text-on-surface-variant">
            From P25 dispatch audio · last <span className="font-mono">{radioIncidents?.window_hours ?? 24}h</span>
            {radioIncidents?.ts && <> · updated <span className="font-mono">{hhmm(radioIncidents.ts)}</span></>}
          </p>
        </div>
        <div className="lg:hidden flex shrink-0 border border-white/10" role="group" aria-label="View">
          {(['list', 'map'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setMobileView(v)}
              aria-pressed={mobileView === v}
              className={`h-8 px-3 flex items-center gap-1 font-mono text-[11px] uppercase tracking-widest ${mobileView === v ? 'bg-amber-gold text-onyx-black font-bold' : 'text-on-surface-variant'}`}
            >
              <span className="ms text-[16px] leading-none" aria-hidden="true">{v === 'list' ? 'list' : 'map'}</span>
              {v}
            </button>
          ))}
        </div>
      </div>

      <ChipRow>
        {FILTERS.map((f) => (
          <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}
            activeClass="border-amber-gold text-amber-gold bg-amber-gold/10 font-bold">
            {f.label} <span className="opacity-70">{counts[f.id] ?? 0}</span>
          </Chip>
        ))}
        <span className="w-px h-5 bg-white/10" aria-hidden="true" />
        <Chip active={activeOnly} onClick={() => setActiveOnly((v) => !v)}
          activeClass="border-amber-gold text-amber-gold bg-amber-gold/10">
          Active now
        </Chip>
        <Chip active={showRoutine} onClick={() => setShowRoutine((v) => !v)}
          activeClass="border-amber-gold text-amber-gold bg-amber-gold/10">
          Include routine
        </Chip>
        {zones.length > 0 && (
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            aria-label="Filter by zone"
            className="h-8 bg-onyx-deep border border-white/10 text-on-surface font-mono text-[11px] uppercase tracking-widest px-2 focus:outline-none focus:border-amber-gold/60"
          >
            <option value="">All zones</option>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        )}
      </ChipRow>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start">
        <div className={mobileView === 'list' ? '' : 'hidden lg:block'}>
          {radioIncidents == null ? (
            <EmptyState icon="hourglass_empty">Waiting for dispatch data…</EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState icon="filter_alt_off">No incidents match these filters.</EmptyState>
          ) : (
            <ul className="space-y-2 lg:max-h-[560px] lg:overflow-y-auto lg:pr-1">
              {shown.map((i) => (
                <IncidentCard
                  key={i.id}
                  incident={i}
                  now={now}
                  selected={i.id === selectedId}
                  onSelect={() => setSelectedId(i.id === selectedId ? null : i.id)}
                />
              ))}
            </ul>
          )}
        </div>
        <div className={`lg:sticky lg:top-4 ${mobileView === 'map' ? '' : 'hidden lg:block'}`}>
          <IncidentMap incidents={shown} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>
    </section>
  )
}
