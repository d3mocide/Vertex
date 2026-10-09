import { trackPassesFacets } from '../../entityFacets'
import { useState } from 'react'
import { ALT_RANGE_DEFAULT, SPD_RANGE_DEFAULT, useCivicPick } from '../../store'
import { getDistanceMeters } from '../../layers/geoUtils'
import { DEFAULT_CENTER } from '../../config'

const TYPE_ICON: Record<string, string> = {
  aircraft:       'flight',
  vessel:         'sailing',
  train:          'directions_railway',
  bus:            'directions_bus',
  aprs:           'sensors',
  fire_incident:  'local_fire_department',
  mesh_node:      'hub',
  satellite:      'satellite_alt',
  stream_gauge:   'waves',
}
const TYPE_COLOR: Record<string, string> = {
  aircraft:       'text-cyan-adsb',
  vessel:         'text-green-ais',
  train:          'text-amber-gold',
  bus:            'text-transit-bus',
  aprs:           'text-cyan-adsb',
  fire_incident:  'text-red-emergency',
  satellite:      'text-violet-space',
}

function RangeSlider({
  label, min, max, value, unit, onChange,
}: {
  label: string
  min: number
  max: number
  value: [number, number]
  unit: string
  onChange: (r: [number, number]) => void
}) {
  const pct = (v: number) => ((v - min) / (max - min)) * 100

  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="label-caps text-[11px]">{label}</span>
        <span className="font-mono text-[11px] text-on-surface-variant">
          {value[0].toLocaleString()}–{value[1].toLocaleString()} {unit}
        </span>
      </div>
      <div className="relative h-1.5 bg-surface-container rounded-full">
        <div
          className="absolute top-0 bottom-0 bg-amber-gold rounded-full"
          style={{ left: `${pct(value[0])}%`, right: `${100 - pct(value[1])}%` }}
          aria-hidden="true"
        />
        <input
          type="range" min={min} max={max} step={Math.round((max - min) / 100)}
          value={value[0]}
          onChange={(e) => onChange([Math.min(Number(e.target.value), value[1] - 1), value[1]])}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          aria-label={`${label} minimum`}
        />
        <input
          type="range" min={min} max={max} step={Math.round((max - min) / 100)}
          value={value[1]}
          onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), value[0] + 1)])}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          aria-label={`${label} maximum`}
        />
      </div>
    </div>
  )
}

export function EntitySearchPanel() {
  const {
    tracks,
    entities,
    entitySearchQuery,
    setEntitySearchQuery,
    entityAltRange,
    setEntityAltRange,
    entitySpeedRange,
    setEntitySpeedRange,
    entityFilter,
    subFilters,
    setEntityFilter,
    selectEntity,
    selectedEntityId,
    entityMissionTags,
  } = useCivicPick('tracks', 'entities', 'entitySearchQuery', 'setEntitySearchQuery', 'entityAltRange', 'setEntityAltRange', 'entitySpeedRange', 'setEntitySpeedRange', 'entityFilter', 'setEntityFilter', 'subFilters', 'selectEntity', 'selectedEntityId', 'entityMissionTags')

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [taggedOnly, setTaggedOnly] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const advancedFiltered = (
    entityAltRange[0] !== ALT_RANGE_DEFAULT[0] ||
    entityAltRange[1] !== ALT_RANGE_DEFAULT[1] ||
    entitySpeedRange[0] !== SPD_RANGE_DEFAULT[0] ||
    entitySpeedRange[1] !== SPD_RANGE_DEFAULT[1] ||
    !entityFilter.adsbLocal || !entityFilter.adsbSupplement
  )

  const isFiltered = taggedOnly || entitySearchQuery !== '' || advancedFiltered

  const resetFilters = () => {
    setEntitySearchQuery('')
    setEntityAltRange(ALT_RANGE_DEFAULT)
    setEntitySpeedRange(SPD_RANGE_DEFAULT)
    setEntityFilter({ adsbLocal: true, adsbSupplement: true })
    setTaggedOnly(false)
  }

  const ALT_M_TO_FT = 3.28084
  const MS_TO_KT    = 1.94384
  const [minAlt, maxAlt] = entityAltRange
  const [minSpd, maxSpd] = entitySpeedRange
  const q = entitySearchQuery.toLowerCase()

  const matchedTracks = Object.values(tracks).filter((track) => {
    if (track.type === 'air' && !entityFilter.aircraft) return false
    if (track.type === 'sea' && !entityFilter.vessel) return false
    if (track.type === 'rail' && !entityFilter.train) return false
    if (track.type === 'bus' && !entityFilter.bus) return false
    if (track.type === 'ground' && !entityFilter.aprs) return false
    if (track.type === 'hazard' && !entityFilter.fire_incident) return false
    if (!trackPassesFacets(track, subFilters)) return false
    if (taggedOnly && !(entityMissionTags[track.uid]?.length > 0)) return false
    if (q) {
      const name = (track.callsign ?? track.uid).toLowerCase()
      if (!name.includes(q) && !track.uid.toLowerCase().includes(q)) return false
    }
    const altFt = track.altMeters * ALT_M_TO_FT
    if (track.type === 'air' && (altFt < minAlt || altFt > maxAlt)) return false
    const spdKt = track.speedMs * MS_TO_KT
    if (spdKt < minSpd || spdKt > maxSpd) return false
    return true
  }).sort((a, b) => {
    const priority: Record<string, number> = { hazard: 0, air: 10, sea: 20, ground: 30 }
    const distA = getDistanceMeters(DEFAULT_CENTER[0], DEFAULT_CENTER[1], a.lon, a.lat) / 1000
    const distB = getDistanceMeters(DEFAULT_CENTER[0], DEFAULT_CENTER[1], b.lon, b.lat) / 1000
    const scoreA = (priority[a.type] ?? 40) + distA
    const scoreB = (priority[b.type] ?? 40) + distB
    return scoreA - scoreB
  })

  return (
    <div className="absolute bottom-14 left-2 right-2 lg:bottom-auto lg:top-28 lg:right-auto lg:left-4 z-30 lg:w-80 hud-panel overflow-hidden max-h-[50vh] lg:max-h-none">
      {/* Search input */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        <span className="ms text-[14px] text-on-surface-variant leading-none shrink-0">search</span>
        <input
          type="search"
          placeholder="Callsign / ICAO / MMSI…"
          value={entitySearchQuery}
          onChange={(e) => setEntitySearchQuery(e.target.value)}
          className="flex-1 bg-transparent text-on-surface placeholder-on-surface-variant text-[12px] focus:outline-hidden"
          aria-label="Search entities"
        />
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          title="Toggle filters"
          className={`ms text-[16px] leading-none shrink-0 transition-colors focus:outline-hidden ${filtersOpen || isFiltered ? 'text-amber-gold' : 'text-on-surface-variant hover:text-on-surface'}`}
          aria-expanded={filtersOpen}
          aria-label="Toggle filter options"
        >
          {isFiltered ? 'filter_alt' : 'filter_list'}
        </button>
      </div>

      {/* Expandable filters */}
      {filtersOpen && (
        <div className="px-3 py-3 border-b border-white/5 stack-y-4 bg-onyx-deep/60">
          {/* Tagged only */}
          <div>
            <button
              onClick={() => setTaggedOnly((v) => !v)}
              className={`flex items-center gap-1.5 px-2 py-1 border text-[11px] uppercase tracking-widest font-bold transition-colors focus:outline-hidden ${
                taggedOnly
                  ? 'text-amber-gold border-amber-gold/60 bg-amber-gold/10'
                  : 'text-on-surface-variant border-white/10 hover:border-white/20'
              }`}
              aria-pressed={taggedOnly}
            >
              <span className="ms text-[12px] leading-none">label</span>
              Tagged only
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="label-caps text-[11px]">Filter Detail</span>
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className={`flex items-center gap-1 px-2 py-1 border text-[11px] uppercase tracking-widest font-bold transition-colors focus:outline-hidden ${
                advancedOpen || advancedFiltered
                  ? 'text-amber-gold border-amber-gold/60 bg-amber-gold/10'
                  : 'text-on-surface-variant border-white/10 hover:border-white/20'
              }`}
              aria-expanded={advancedOpen}
              aria-label="Toggle advanced filters"
            >
              <span className="ms text-[12px] leading-none">tune</span>
              {advancedOpen ? 'Hide advanced' : 'Advanced'}
              <span className="ms text-[12px] leading-none">{advancedOpen ? 'expand_less' : 'expand_more'}</span>
            </button>
          </div>

          <p className="text-[11px] text-on-surface-variant leading-snug">
            Choose entity types and trails in Layers. These controls narrow the enabled entities.
          </p>

          {advancedOpen && (
            <>
              {/* ADS-B source toggles */}
              {entityFilter.aircraft && (
                <div>
                  <span className="label-caps text-[11px] block mb-2">ADS-B Sources</span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setEntityFilter({ adsbLocal: !entityFilter.adsbLocal })}
                      className={`flex items-center gap-1 px-2 py-1 border text-[11px] uppercase tracking-widest font-bold transition-colors focus:outline-hidden ${
                        entityFilter.adsbLocal
                          ? 'text-cyan-adsb border-cyan-adsb/60 bg-cyan-adsb/10'
                          : 'text-on-surface-variant border-white/10 hover:border-white/20'
                      }`}
                      aria-pressed={entityFilter.adsbLocal}
                    >
                      <span className="ms text-[12px] leading-none">sensors</span>
                      Local (BEAST/UF)
                    </button>
                    <button
                      onClick={() => setEntityFilter({ adsbSupplement: !entityFilter.adsbSupplement })}
                      className={`flex items-center gap-1 px-2 py-1 border text-[11px] uppercase tracking-widest font-bold transition-colors focus:outline-hidden ${
                        entityFilter.adsbSupplement
                          ? 'text-amber-gold border-amber-gold/60 bg-amber-gold/10'
                          : 'text-on-surface-variant border-white/10 hover:border-white/20'
                      }`}
                      aria-pressed={entityFilter.adsbSupplement}
                    >
                      <span className="ms text-[12px] leading-none">public</span>
                      OpenSky Supplement
                    </button>
                  </div>
                </div>
              )}

              {/* Altitude range */}
              {entityFilter.aircraft && (
                <RangeSlider
                  label="Altitude" min={0} max={60_000}
                  value={entityAltRange} unit="ft"
                  onChange={setEntityAltRange}
                />
              )}

              {/* Speed range */}
              <RangeSlider
                label="Speed" min={0} max={600}
                value={entitySpeedRange} unit="kts"
                onChange={setEntitySpeedRange}
              />
            </>
          )}

          {isFiltered && (
            <button
              onClick={resetFilters}
              className="text-[11px] text-amber-gold hover:text-amber-gold/80 uppercase tracking-widest transition-colors focus:outline-hidden"
            >
              Reset search filters
            </button>
          )}
        </div>
      )}

      {/* Matched entity list — hidden on mobile until the user starts searching */}
      <div className={`max-h-48 overflow-y-auto divide-y divide-white/5 ${entitySearchQuery === '' && !filtersOpen ? 'hidden lg:block' : ''}`}>
          {matchedTracks.length === 0 ? (
            <div className="px-3 py-4 flex flex-col items-center gap-1 text-on-surface-variant/50">
              <span className="ms text-[20px]">search_off</span>
              <span className="text-[11px] uppercase tracking-widest">No matches</span>
            </div>
          ) : (
            matchedTracks.slice(0, 20).map((track) => {
              const entity = entities[track.uid]
              const isSelected = selectedEntityId === track.uid
              const altFt  = Math.round(track.altMeters * ALT_M_TO_FT)
              const spdKt  = Math.round(track.speedMs * MS_TO_KT)
              const trackKey = track.type === 'air'
                ? 'aircraft'
                : track.type === 'sea'
                ? 'vessel'
                : track.type === 'bus'
                ? 'bus'
                : track.type === 'rail'
                ? 'train'
                : track.type === 'ground'
                ? 'aprs'
                : 'fire_incident'
              const color  = TYPE_COLOR[trackKey]
              const icon   = TYPE_ICON[trackKey]

              const firstTag = (entityMissionTags[track.uid] ?? [])[0]

              return (
                <button
                  key={track.uid}
                  onClick={() => selectEntity(isSelected ? null : track.uid)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors focus:outline-hidden ${
                    isSelected ? 'bg-amber-gold/10' : 'hover:bg-surface-container'
                  }`}
                  aria-pressed={isSelected}
                >
                  <span className={`ms text-[14px] leading-none shrink-0 ${color}`}>{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[11px] text-on-surface truncate flex items-center gap-1">
                      {track.callsign ?? track.uid}
                      {firstTag && (
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: firstTag.color }}
                          title={firstTag.tag}
                        />
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-on-surface-variant">
                      {track.type === 'air' ? `${altFt.toLocaleString()} ft` : ''}
                      {track.type === 'air' && spdKt > 0 ? ' · ' : ''}
                      {(track.type === 'air' || track.type === 'sea' || track.type === 'ground') && spdKt > 0 ? `${spdKt} kts` : ''}
                      {` · ${(getDistanceMeters(DEFAULT_CENTER[0], DEFAULT_CENTER[1], track.lon, track.lat) / 1000).toFixed(1)} km`}
                      {entity?.status ? ` · ${entity.status}` : ''}
                    </div>
                  </div>
                  {isSelected && (
                    <span className="ms text-[12px] text-amber-gold shrink-0 leading-none">my_location</span>
                  )}
                </button>
              )
            })
          )}
          {matchedTracks.length > 20 && (
            <div className="px-3 py-2 text-[11px] text-on-surface-variant text-center">
              +{matchedTracks.length - 20} more — refine search
            </div>
          )}

        </div>
    </div>
  )
}
