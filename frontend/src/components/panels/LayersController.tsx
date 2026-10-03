import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useCivicStore } from '../../store'
import { useContractAvailable } from '../../hooks/useCapabilities'
import { getDevMap } from '../../devtools/devState'
import { activeFacetCount, facetsFor, meshValues, trackValues, type FacetEntity } from '../../entityFacets'
import type { SubFilters, Track } from '../../storeTypes'

type Kind = 'flag' | 'entity'

interface LayerDef {
  key: string
  kind: Kind
  label: string
  icon: string
  /** Regional data contract that must have a provider before the layer is offered. */
  contract?: string
}

interface GroupDef { id: string; label: string; layers: LayerDef[] }

const GROUPS: GroupDef[] = [
  { id: 'live', label: 'Live traffic', layers: [
    { key: 'aircraft', kind: 'entity', label: 'Aircraft', icon: 'flight' },
    { key: 'vessel', kind: 'entity', label: 'Vessels', icon: 'sailing' },
    { key: 'bus', kind: 'entity', label: 'Buses', icon: 'directions_bus' },
    { key: 'train', kind: 'entity', label: 'Trains', icon: 'directions_railway' },
    { key: 'railTracksVisible', kind: 'flag', label: 'Rail tracks', icon: 'route' },
    { key: 'mesh_node', kind: 'entity', label: 'Mesh nodes', icon: 'hub' },
    { key: 'aprs', kind: 'entity', label: 'APRS', icon: 'sensors' },
    { key: 'camerasVisible', kind: 'flag', label: 'Cameras', icon: 'videocam', contract: 'traffic.cameras' },
    { key: 'trailsVisible', kind: 'flag', label: 'Trails', icon: 'timeline' },
  ] },
  { id: 'weather', label: 'Weather', layers: [
    { key: 'radarVisible', kind: 'flag', label: 'Radar', icon: 'radar' },
    { key: 'goesVisible', kind: 'flag', label: 'Infrared', icon: 'satellite_alt' },
    { key: 'smokeVisible', kind: 'flag', label: 'Visible sat', icon: 'filter_drama' },
    { key: 'nwsAlertsVisible', kind: 'flag', label: 'NWS alerts', icon: 'notification_important' },
    { key: 'lightningVisible', kind: 'flag', label: 'Lightning', icon: 'bolt' },
    { key: 'lightningDensityVisible', kind: 'flag', label: 'Strike density', icon: 'electric_bolt' },
  ] },
  { id: 'hazards', label: 'Hazards', layers: [
    { key: 'fire_incident', kind: 'entity', label: 'Fire incidents', icon: 'local_fire_department' },
    { key: 'firePerimetersVisible', kind: 'flag', label: 'Fire perimeters', icon: 'fire_truck' },
    { key: 'fireDangerVisible', kind: 'flag', label: 'Fire danger', icon: 'whatshot', contract: 'fire.danger' },
    { key: 'gaugesVisible', kind: 'flag', label: 'Stream gauges', icon: 'water' },
    { key: 'outagesVisible', kind: 'flag', label: 'Power outages', icon: 'power_off', contract: 'outages.areas' },
  ] },
  { id: 'ops', label: 'Operations', layers: [
    { key: 'dispatchVisible', kind: 'flag', label: 'Dispatch', icon: 'cell_tower' },
    { key: 'geofencesVisible', kind: 'flag', label: 'Zone monitor', icon: 'verified_user' },
  ] },
]

const ALL_DEFS = GROUPS.flatMap(g => g.layers)

/**
 * A preset is a complete picture of the map: the layers it lists are on and every other layer is off, entity types
 * included, so choosing one never leaves stray clutter behind. 'overview' matches the stock defaults.
 */
interface Preset { id: string; label: string; icon: string; hint: string; on: string[]; sub?: SubFilters }

const PRESETS: Preset[] = [
  { id: 'overview', label: 'Overview', icon: 'dashboard', hint: 'Everything live, the everyday picture',
    on: ['aircraft', 'vessel', 'bus', 'train', 'mesh_node', 'aprs', 'fire_incident', 'trailsVisible', 'railTracksVisible',
      'lightningVisible', 'gaugesVisible', 'dispatchVisible', 'geofencesVisible'] },
  { id: 'weather', label: 'Weather watch', icon: 'thunderstorm', hint: 'Radar, alerts, lightning, stream gauges and weather stations',
    on: ['radarVisible', 'nwsAlertsVisible', 'lightningVisible', 'gaugesVisible', 'aprs'], sub: { 'aprs.station': ['weather'] } },
  { id: 'fire', label: 'Fire', icon: 'local_fire_department', hint: 'Incidents, perimeters, danger, smoke, red-flag alerts, fire calls and firefighting, rescue and medical aircraft',
    on: ['fire_incident', 'firePerimetersVisible', 'fireDangerVisible', 'smokeVisible', 'nwsAlertsVisible', 'dispatchVisible', 'aircraft'],
    sub: { 'aircraft.who': ['fire', 'rescue', 'medical'] } },
  { id: 'incidents', label: 'Incidents', icon: 'emergency', hint: 'Radio dispatch, fire incidents, alerts, outages, your zones and emergency-service aircraft',
    on: ['dispatchVisible', 'fire_incident', 'nwsAlertsVisible', 'outagesVisible', 'geofencesVisible', 'aircraft'],
    sub: { 'aircraft.who': ['medical', 'rescue', 'fire', 'law_enforcement', 'alert'] } },
  { id: 'traffic', label: 'Traffic & transit', icon: 'traffic', hint: 'Buses, trains, rail, cameras and crash calls',
    on: ['bus', 'train', 'railTracksVisible', 'camerasVisible', 'dispatchVisible'] },
  { id: 'airsea', label: 'Air & marine', icon: 'flight', hint: 'Aircraft in the air and vessels, with their trails',
    on: ['aircraft', 'vessel', 'trailsVisible'], sub: { 'aircraft.state': ['airborne'] } },
  { id: 'comms', label: 'Radio & mesh', icon: 'cell_tower', hint: 'Mesh nodes, APRS stations and radio dispatch',
    on: ['mesh_node', 'aprs', 'dispatchVisible'] },
]

type Store = Record<string, unknown>

function setter(key: string): ((v: boolean) => void) | undefined {
  const fn = (useCivicStore.getState() as unknown as Store)[`set${key[0].toUpperCase()}${key.slice(1)}`]
  return typeof fn === 'function' ? (fn as (v: boolean) => void) : undefined
}

function setLayer(def: LayerDef, value: boolean): void {
  if (def.kind === 'entity') useCivicStore.getState().setEntityFilter({ [def.key]: value })
  else setter(def.key)?.(value)
}

function readLayer(state: Store & { entityFilter: Record<string, boolean> }, def: LayerDef): boolean {
  return Boolean(def.kind === 'entity' ? state.entityFilter[def.key] : state[def.key])
}

const TRIGGER_CLASS = `relative flex items-center gap-2 px-3 py-2 hud-panel border border-amber-gold-muted text-[11px] font-mono uppercase
  tracking-widest shadow-2xl hover:border-amber-gold/60 transition-colors focus:outline-none`

function Tile({ def, on, facetCount = 0, facetOpen = false, onFacet }: {
  def: LayerDef; on: boolean; facetCount?: number; facetOpen?: boolean; onFacet?: () => void
}) {
  const toggle = () => setLayer(def, !on)
  const border = on ? 'border-amber-gold bg-amber-gold/10' : 'border-outline-variant hover:border-white/30'
  const focus = 'focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold'
  return (
    <div className="flex min-w-0">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-2 border text-left text-[11px] font-bold uppercase tracking-wider transition-colors ${focus} ${border} ${on ? 'text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}
      >
        <span className={`ms text-[16px] leading-none ${on ? 'text-amber-gold' : ''}`} aria-hidden="true">{def.icon}</span>
        <span className="truncate">{def.label}</span>
        {facetCount > 0 && <span className="font-mono text-amber-gold" title="Sub-filters active">{facetCount}</span>}
      </button>
      {onFacet && (
        <button
          type="button"
          onClick={onFacet}
          aria-expanded={facetOpen}
          aria-label={`Filter ${def.label} by type`}
          title={`Filter ${def.label} by type`}
          className={`px-1.5 border border-l-0 transition-colors ${focus} ${facetCount > 0 || facetOpen ? 'border-amber-gold text-amber-gold' : 'border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-white/30'}`}
        >
          <span className="ms text-[16px] leading-none" aria-hidden="true">{facetOpen ? 'expand_less' : 'tune'}</span>
        </button>
      )}
    </div>
  )
}

const TRACK_KIND: Record<string, Track['type']> = { aircraft: 'air', vessel: 'sea', aprs: 'ground' }

/** How many entities currently carry each facet value, refreshed every few seconds while the filters are open. */
function useFacetCounts(entity: FacetEntity): Record<string, Record<string, number>> {
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
  useEffect(() => {
    const compute = () => {
      const st = useCivicStore.getState()
      const out: Record<string, Record<string, number>> = {}
      for (const facet of facetsFor(entity)) {
        const tally: Record<string, number> = {}
        if (entity === 'mesh_node') {
          for (const e of Object.values(st.entities)) {
            if (e.entity_type === 'mesh_node') for (const v of meshValues(e, facet.id)) tally[v] = (tally[v] ?? 0) + 1
          }
        } else {
          for (const t of Object.values(st.tracks)) {
            if (t.type === TRACK_KIND[entity]) for (const v of trackValues(t, facet.id)) tally[v] = (tally[v] ?? 0) + 1
          }
        }
        out[facet.id] = tally
      }
      setCounts(out)
    }
    compute()
    const id = window.setInterval(compute, 3000)
    return () => window.clearInterval(id)
  }, [entity])
  return counts
}

function FacetPanel({ entity, title, filters }: { entity: FacetEntity; title: string; filters: SubFilters }) {
  const counts = useFacetCounts(entity)
  const facets = facetsFor(entity)
  const toggle = (facetId: string, value: string) => {
    const current = filters[facetId] ?? []
    useCivicStore.getState().setSubFilter(facetId, current.includes(value) ? current.filter(v => v !== value) : [...current, value])
  }
  const active = activeFacetCount(entity, filters)
  return (
    <div className="mt-2 border border-outline-variant p-2.5 space-y-2.5" role="group" aria-label={`${title} filters`}>
      <div className="flex items-center justify-between">
        <span className="label-caps">{title}</span>
        <button
          type="button"
          disabled={active === 0}
          onClick={() => facets.forEach(f => useCivicStore.getState().setSubFilter(f.id, []))}
          className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-amber-gold disabled:opacity-40 disabled:hover:text-on-surface-variant focus:outline-none"
        >
          Show all
        </button>
      </div>
      {facets.map((facet) => (
        <div key={facet.id}>
          <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">{facet.label}</div>
          <div className="flex flex-wrap gap-1">
            {facet.options.map((o) => {
              const picked = (filters[facet.id] ?? []).includes(o.value)
              const n = counts[facet.id]?.[o.value] ?? 0
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={picked}
                  onClick={() => toggle(facet.id, o.value)}
                  className={`px-2 py-1 border text-[11px] font-bold tracking-wide transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${picked
                    ? 'border-amber-gold bg-amber-gold/10 text-amber-gold'
                    : n === 0 ? 'border-outline-variant text-on-surface-variant/50 hover:text-on-surface-variant'
                      : 'border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-white/30'}`}
                >
                  {o.label} <span className="font-mono">{n}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-on-surface-variant leading-snug">
        Nothing selected shows everything. Pick several to see any of them.
      </p>
    </div>
  )
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3 mt-2">
      <span className="label-caps w-20 shrink-0">{label}</span>
      <div className="relative flex-1 h-1 bg-surface-container-highest rounded-full overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 bg-amber-gold" style={{ width: `${((value - min) / (max - min)) * 100}%` }} aria-hidden="true" />
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
          onChange={(e) => onChange(parseFloat(e.target.value))} className="absolute inset-0 w-full opacity-0 cursor-pointer" />
      </div>
      <span className="font-mono text-[11px] text-on-surface-variant w-9 text-right">{format(value)}</span>
    </div>
  )
}

const PITCHES: { label: string; pitch: number }[] = [
  { label: '2D', pitch: 0 }, { label: '45°', pitch: 45 }, { label: '60°', pitch: 60 },
]

function ViewControls() {
  const terrainEnabled = useCivicStore((s) => s.terrainEnabled)
  const terrainExaggeration = useCivicStore((s) => s.terrainExaggeration)
  const setTerrainExaggeration = useCivicStore((s) => s.setTerrainExaggeration)
  const [pitch, setPitch] = useState(() => Math.round(getDevMap()?.getPitch() ?? 0))

  useEffect(() => {
    const map = getDevMap()
    if (!map) return
    const sync = () => setPitch(Math.round(map.getPitch()))
    map.on('pitchend', sync)
    return () => { map.off('pitchend', sync) }
  }, [])

  const tilt = (target: number) => {
    // Tilting above flat needs relief to be worth it, but works either way; the map clamps to its own maxPitch.
    getDevMap()?.easeTo({ pitch: target, duration: 500 })
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-1.5">
        <Tile def={{ key: 'terrainEnabled', kind: 'flag', label: '3D terrain', icon: 'landscape' }} on={terrainEnabled} />
        <button
          type="button"
          onClick={() => getDevMap()?.easeTo({ bearing: 0, duration: 500 })}
          className="flex items-center gap-2 px-2 py-2 border border-outline-variant text-left text-[11px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-on-surface hover:border-white/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
        >
          <span className="ms text-[16px] leading-none" aria-hidden="true">explore</span>
          Reset north
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5 mt-1.5" role="group" aria-label="Camera tilt">
        {PITCHES.map((p) => {
          const active = Math.abs(pitch - p.pitch) <= 3
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => tilt(p.pitch)}
              aria-pressed={active}
              className={`px-2 py-1.5 border font-mono text-[11px] font-bold uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${active
                ? 'border-amber-gold bg-amber-gold/10 text-amber-gold'
                : 'border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-white/30'}`}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      {terrainEnabled && (
        <Slider label="Relief" value={terrainExaggeration} min={0.5} max={5} step={0.5}
          format={(v) => `${v.toFixed(1)}×`} onChange={setTerrainExaggeration} />
      )}
    </div>
  )
}

function LayersPanel({ onClose }: { onClose: () => void }) {
  // Only the layer switches and filters: the whole store changes with every position report.
  const state = useCivicStore(useShallow((s) => {
    const slice: Record<string, unknown> = { entityFilter: s.entityFilter, subFilters: s.subFilters }
    for (const d of ALL_DEFS) if (d.kind === 'flag') slice[d.key] = (s as unknown as Store)[d.key]
    return slice
  })) as unknown as Store & { entityFilter: Record<string, boolean>; subFilters: SubFilters }
  const [openFacet, setOpenFacet] = useState<FacetEntity | null>(null)
  const hasContract: Record<string, boolean> = {
    'fire.danger': useContractAvailable('fire.danger'),
    'outages.areas': useContractAvailable('outages.areas'),
    'traffic.cameras': useContractAvailable('traffic.cameras'),
  }
  const radarOpacity = useCivicStore((s) => s.radarOpacity)
  const setRadarOpacity = useCivicStore((s) => s.setRadarOpacity)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const available = (def: LayerDef) => !def.contract || hasContract[def.contract]
  const offered = ALL_DEFS.filter(available)
  const sameSubFilters = (a: SubFilters, b: SubFilters) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every(k => [...(a[k] ?? [])].sort().join() === [...(b[k] ?? [])].sort().join())
  }
  const activePreset = PRESETS.find(p => offered.every(d => readLayer(state, d) === p.on.includes(d.key)) && sameSubFilters(state.subFilters, p.sub ?? {}))
  const onCount = offered.filter(d => readLayer(state, d)).length
  const applyPreset = (p: Preset) => {
    offered.forEach(d => setLayer(d, p.on.includes(d.key)))
    useCivicStore.getState().setSubFilters(p.sub ?? {})
  }

  return (
    <div
      role="dialog"
      aria-label="Map layers"
      className="fixed inset-x-2 bottom-[calc(7.25rem+env(safe-area-inset-bottom))] lg:bottom-auto lg:inset-x-auto lg:top-[calc(var(--chrome-top)+7rem)] lg:right-4 z-[45] lg:w-[400px] max-h-[58vh] lg:max-h-[calc(100vh-14rem)] flex flex-col hud-panel cursor-default"
    >
      {/* Header and presets stay put; only the layer list scrolls. */}
      <div className="shrink-0 p-4 pb-3 border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="ms text-[16px] text-amber-gold leading-none" aria-hidden="true">layers</span>
            <span className="font-bold text-[11px] tracking-[0.2em] uppercase text-amber-gold">Map layers</span>
            <span className="font-mono text-[11px] text-on-surface-variant">{onCount} on</span>
          </div>
          <button onClick={onClose} className="ms text-[20px] text-on-surface-variant hover:text-on-surface leading-none p-1 focus:outline-none" title="Close layers" aria-label="Close layers">close</button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1" role="group" aria-label="Presets">
          {PRESETS.map((p) => {
            const active = activePreset?.id === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                aria-pressed={active}
                title={p.hint}
                className={`shrink-0 flex items-center gap-1.5 px-2.5 py-2 border text-[11px] font-bold uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${active
                  ? 'border-amber-gold text-amber-gold bg-amber-gold/10'
                  : 'border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-white/30'}`}
              >
                <span className="ms text-[14px] leading-none" aria-hidden="true">{p.icon}</span>{p.label}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-on-surface-variant leading-snug min-h-[1.5em]">
          {activePreset ? activePreset.hint : 'Custom mix. Pick a preset to start from a known picture.'}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
        {GROUPS.map((g) => {
          const defs = g.layers.filter(available)
          if (defs.length === 0) return null
          return (
            <section key={g.id} className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="section-heading">{g.label}</h2>
                <div className="flex gap-3 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                  <button type="button" className="hover:text-amber-gold focus:outline-none" onClick={() => defs.forEach(d => setLayer(d, true))}>All</button>
                  <button type="button" className="hover:text-amber-gold focus:outline-none" onClick={() => defs.forEach(d => setLayer(d, false))}>None</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {defs.map((d) => {
                  const facetEntity = d.kind === 'entity' && facetsFor(d.key as FacetEntity).length > 0 ? d.key as FacetEntity : null
                  return (
                    <Tile
                      key={d.key}
                      def={d}
                      on={readLayer(state, d)}
                      facetCount={facetEntity ? activeFacetCount(facetEntity, state.subFilters) : 0}
                      facetOpen={facetEntity !== null && openFacet === facetEntity}
                      onFacet={facetEntity ? () => setOpenFacet(openFacet === facetEntity ? null : facetEntity) : undefined}
                    />
                  )
                })}
              </div>
              {openFacet && defs.some(d => d.key === openFacet) && (
                <FacetPanel entity={openFacet} title={`${defs.find(d => d.key === openFacet)?.label ?? ''} types`} filters={state.subFilters} />
              )}
              {g.id === 'weather' && Boolean(state.radarVisible) && (
                <Slider label="Opacity" value={radarOpacity} min={0.1} max={1} step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`} onChange={setRadarOpacity} />
              )}
            </section>
          )
        })}

        <section>
          <h2 className="section-heading mb-2">View</h2>
          <ViewControls />
        </section>
      </div>
    </div>
  )
}

export function LayersController() {
  const [open, setOpen] = useState(false)
  const count = useCivicStore((s) => ALL_DEFS.reduce((n, d) => n + (readLayer(s as unknown as Store & { entityFilter: Record<string, boolean> }, d) ? 1 : 0), 0))
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`${TRIGGER_CLASS} ${open ? 'text-amber-gold border-amber-gold' : 'text-on-surface-variant'}`}
        aria-expanded={open}
        title="Map layers"
      >
        <span className="ms text-[16px] leading-none">layers</span>
        LAYERS
        <span className="font-mono text-amber-gold">{count}</span>
      </button>
      {open && <LayersPanel onClose={() => setOpen(false)} />}
    </div>
  )
}
