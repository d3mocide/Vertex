import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useCivicStore } from '../../store'
import { useContractAvailable } from '../../hooks/useCapabilities'
import { getDevMap } from '../../devtools/devState'
import { activeFacetCount, facetsFor, meshValues, trackValues, type FacetEntity } from '../../entityFacets'
import type { SubFilters, Track } from '../../storeTypes'
import { ALL_DEFS, GROUPS, PRESETS, type LayerDef, type Scene } from '../../layers/layerCatalog'
import { DISPATCH_FILTERS } from '../../layers/dispatchFilter'
import { deleteView, loadViews, saveView, type SavedView } from '../../layers/layerViews'

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

function useOfferedLayers() {
  const available: Record<string, boolean> = {
    'fire.danger': useContractAvailable('fire.danger'),
    'outages.areas': useContractAvailable('outages.areas'),
    'traffic.cameras': useContractAvailable('traffic.cameras'),
  }
  return ALL_DEFS.filter(d => !d.contract || available[d.contract])
}

const TRIGGER_CLASS = `relative flex items-center gap-2 px-3 py-2 hud-panel border border-amber-gold-muted text-[11px] font-mono uppercase
  tracking-widest shadow-2xl hover:border-amber-gold/60 transition-colors focus:outline-hidden`

function Tile({ def, on, facetCount = 0, facetOpen = false, onFacet }: {
  def: LayerDef; on: boolean; facetCount?: number; facetOpen?: boolean; onFacet?: () => void
}) {
  const toggle = () => setLayer(def, !on)
  const border = on ? 'border-amber-gold/40 bg-amber-gold/5' : 'border-outline-variant hover:border-white/30'
  const focus = 'focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold'
  return (
    <div className="flex min-w-0">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        className={`flex-1 min-w-0 flex items-center gap-1.5 px-2 py-2 border text-left text-[11px] font-bold uppercase tracking-wider transition-colors ${focus} ${border} ${on ? 'text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}
      >
        <span className={`ms text-[16px] leading-none ${on ? 'text-amber-gold' : ''}`} aria-hidden="true">{def.icon}</span>
        <span className="truncate">{def.label}</span>
        {facetCount > 0 && <span className="hidden sm:inline font-mono text-amber-gold" title="Sub-filters active">{facetCount}</span>}
        {on && <span className="ms hidden sm:inline-block ml-auto text-[14px] text-amber-gold" aria-hidden="true">check</span>}
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
    <div className="mt-2 border border-outline-variant p-2.5 stack-y-2.5" role="group" aria-label={`${title} filters`}>
      <div className="flex items-center justify-between">
        <span className="label-caps">{title}</span>
        <button
          type="button"
          disabled={active === 0}
          onClick={() => facets.forEach(f => useCivicStore.getState().setSubFilter(f.id, []))}
          className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-amber-gold disabled:opacity-40 disabled:hover:text-on-surface-variant focus:outline-hidden"
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
                  className={`px-2 py-1 border text-[11px] font-bold tracking-wide transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold ${picked
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
          className="flex items-center gap-2 px-2 py-2 border border-outline-variant text-left text-[11px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-on-surface hover:border-white/30 transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold"
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
              className={`px-2 py-1.5 border font-mono text-[11px] font-bold uppercase tracking-wider transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold ${active
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
  const [views, setViews] = useState<SavedView[]>(() => loadViews())
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)   // null: not saving; text: the name being typed
  const offered = useOfferedLayers()
  const [dispatchFiltersOpen, setDispatchFiltersOpen] = useState(false)
  const radarOpacity = useCivicStore((s) => s.radarOpacity)
  const setRadarOpacity = useCivicStore((s) => s.setRadarOpacity)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const available = (def: LayerDef) => offered.some(d => d.key === def.key)
  const sameSubFilters = (a: SubFilters, b: SubFilters) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every(k => [...(a[k] ?? [])].sort().join() === [...(b[k] ?? [])].sort().join())
  }
  const allPresets: Scene[] = [...PRESETS, ...views]
  const matchesScene = (p: Scene) => offered.every(d => readLayer(state, d) === p.on.includes(d.key)) && sameSubFilters(state.subFilters, p.sub ?? {})
  const activePreset = allPresets.find(p => p.id === selectedSceneId && matchesScene(p)) ?? allPresets.find(matchesScene)
  const onCount = offered.filter(d => readLayer(state, d)).length
  const applyPreset = (p: Scene) => {
    setSelectedSceneId(p.id)
    const entityFilter = { ...useCivicStore.getState().entityFilter }
    const flags: Record<string, boolean> = {}
    for (const d of offered) {
      if (d.kind === 'entity') entityFilter[d.key as keyof typeof entityFilter] = p.on.includes(d.key)
      else flags[d.key] = p.on.includes(d.key)
    }
    useCivicStore.setState({ ...flags, entityFilter, subFilters: p.sub ?? {} })
  }

  return (
    <div
      role="dialog"
      aria-label="Map layers"
      className="fixed inset-x-2 bottom-[calc(7.25rem+env(safe-area-inset-bottom))] lg:bottom-auto lg:inset-x-auto lg:top-[calc(var(--chrome-top)+7rem)] lg:right-4 z-45 lg:w-[400px] max-h-[58vh] lg:max-h-[calc(100vh-14rem)] flex flex-col hud-panel cursor-default"
    >
      {/* Header and presets stay put; only the layer list scrolls. */}
      <div className="shrink-0 p-4 pb-3 border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="ms text-[16px] text-amber-gold leading-none" aria-hidden="true">layers</span>
            <span className="font-bold text-[11px] tracking-[0.2em] uppercase text-amber-gold">Map layers</span>
            <span className="font-mono text-[11px] text-on-surface-variant">{onCount} enabled</span>
          </div>
          <button onClick={onClose} className="ms text-[20px] text-on-surface-variant hover:text-on-surface leading-none p-1 focus:outline-hidden" title="Close layers" aria-label="Close layers">close</button>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label htmlFor="map-layer-scene" className="label-caps block mb-1">Layer mix</label>
            <select
              id="map-layer-scene"
              value={activePreset?.id ?? 'custom'}
              onChange={(e) => {
                const scene = allPresets.find(p => p.id === e.target.value)
                if (scene) applyPreset(scene)
              }}
              className="w-full bg-surface-container border border-outline-variant px-2 py-2 text-[12px] text-on-surface focus:outline-hidden focus:border-amber-gold"
            >
              <option value="custom" disabled>Custom mix</option>
              <optgroup label="Presets">
                {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </optgroup>
              {views.length > 0 && <optgroup label="Saved layer mixes">
                {views.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </optgroup>}
            </select>
          </div>
          {naming === null && views.length < 12 && (
            <button type="button" onClick={() => setNaming('')} className="btn-ghost px-2 py-2" aria-label="Save layer mix">
              Save mix
            </button>
          )}
          {activePreset && views.some(v => v.id === activePreset.id) && (
            <button type="button" onClick={() => setViews(deleteView(views, activePreset.id))}
              className="btn-ghost px-2 py-2" aria-label={`Delete saved layer mix ${activePreset.label}`}>
              <span className="ms text-[16px]" aria-hidden="true">delete</span>
            </button>
          )}
        </div>
        {naming !== null && (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (!naming.trim()) return
              const saved = saveView(views, naming, offered.filter(d => readLayer(state, d)).map(d => d.key), state.subFilters)
              setViews(saved)
              setSelectedSceneId(saved.find(v => v.label.toLowerCase() === naming.trim().toLowerCase())?.id ?? null)
              setNaming(null)
            }}
          >
            <input
              autoFocus
              value={naming}
              maxLength={24}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null) } }}
              placeholder="Name this layer mix"
              aria-label="Name for the saved layer mix"
              className="flex-1 min-w-0 bg-surface-container border border-outline-variant px-2 py-1.5 text-[12px] text-on-surface placeholder:text-on-surface-variant focus:outline-hidden focus:border-amber-gold"
            />
            <button type="submit" disabled={!naming.trim()} className="btn-primary px-3 py-1.5 text-[11px] disabled:opacity-40">Save</button>
            <button type="button" onClick={() => setNaming(null)} className="btn-ghost px-3 py-1.5 text-[11px]">Cancel</button>
          </form>
        )}
        <p className="mt-1.5 text-[11px] text-on-surface-variant leading-snug min-h-[1.5em]">
          {activePreset ? (PRESETS.find(p => p.id === activePreset.id)?.hint ?? `Saved layers and filters. Camera and opacity are unchanged.`) : 'Custom mix. Choose a preset or save these layers and filters.'}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
        <details className="mb-4 border-b border-white/10 pb-3">
          <summary className="text-[11px] font-bold text-on-surface cursor-pointer focus-visible:outline-amber-gold">
            Enabled layers <span className="font-mono text-amber-gold">{onCount}</span>
          </summary>
          <div className="flex flex-wrap gap-1 mt-2" aria-label="Enabled layers">
            {offered.filter(d => readLayer(state, d)).map(d => (
              <button key={d.key} type="button" onClick={() => setLayer(d, false)}
                className="btn-ghost px-2 py-1" aria-label={`Hide ${d.label}`}>
                {d.label}<span className="ms ml-1 text-[12px]" aria-hidden="true">close</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-on-surface-variant mt-2">Enabled layers may have no data in the current map area.</p>
        </details>
        {GROUPS.map((g) => {
          const defs = g.layers.filter(available)
          if (defs.length === 0) return null
          return (
            <section key={g.id} className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="section-heading">{g.label}</h2>
                <div className="flex gap-3 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                  <button type="button" className="hover:text-amber-gold focus:outline-hidden" onClick={() => defs.forEach(d => setLayer(d, true))}>All</button>
                  <button type="button" className="hover:text-amber-gold focus:outline-hidden" onClick={() => defs.forEach(d => setLayer(d, false))}>None</button>
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
              {g.id === 'ops' && Boolean(state.dispatchVisible) && (
                <div className="mt-2">
                  <button type="button" className="btn-ghost w-full text-left px-2 py-1.5"
                    aria-expanded={dispatchFiltersOpen} onClick={() => setDispatchFiltersOpen(v => !v)}>
                    Dispatch: {(state.subFilters['dispatch.category'] ?? []).length === 0 ? 'All categories'
                      : DISPATCH_FILTERS.filter(f => state.subFilters['dispatch.category']?.includes(f.value)).map(f => f.label).join(', ')}
                    <span className="ms float-right text-[16px]" aria-hidden="true">{dispatchFiltersOpen ? 'expand_less' : 'tune'}</span>
                  </button>
                  {dispatchFiltersOpen && <div className="border border-outline-variant p-2 mt-1" role="group" aria-label="Dispatch categories">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className="btn-ghost" onClick={() => useCivicStore.getState().setSubFilter('dispatch.category', [])}
                        aria-pressed={(state.subFilters['dispatch.category'] ?? []).length === 0}>All</button>
                      {DISPATCH_FILTERS.map(f => {
                        const selected = state.subFilters['dispatch.category'] ?? []
                        const picked = selected.includes(f.value)
                        return <button key={f.value} type="button" aria-pressed={picked}
                          className={`btn-ghost ${picked ? 'bg-amber-gold/10' : 'text-on-surface-variant border-outline-variant'}`}
                          onClick={() => useCivicStore.getState().setSubFilter('dispatch.category', picked
                            ? selected.filter(v => v !== f.value) : [...selected, f.value])}>{f.label}</button>
                      })}
                    </div>
                    <p className="text-[11px] text-on-surface-variant mt-2">No selection shows all significant incidents. Select categories to narrow the map.</p>
                  </div>}
                </div>
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

export function LayersController({ onOpenChange }: { onOpenChange?: (open: boolean) => void } = {}) {
  const [open, setOpen] = useState(false)
  useEffect(() => { onOpenChange?.(open) }, [open, onOpenChange])
  const offered = useOfferedLayers()
  const count = useCivicStore((s) => offered.reduce((n, d) => n + (readLayer(s as unknown as Store & { entityFilter: Record<string, boolean> }, d) ? 1 : 0), 0))
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`${TRIGGER_CLASS} ${open ? 'text-amber-gold border-amber-gold' : 'text-on-surface-variant'}`}
        aria-expanded={open}
        title={`${count} layers enabled; open to inspect or change`}
      >
        <span className="ms text-[16px] leading-none">layers</span>
        LAYERS
        <span className="font-mono text-amber-gold">{count}</span>
      </button>
      {open && <LayersPanel onClose={() => setOpen(false)} />}
    </div>
  )
}
