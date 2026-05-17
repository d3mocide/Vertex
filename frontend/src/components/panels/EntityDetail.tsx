import { useEffect, useState, useCallback } from 'react'
import { useCivicStore } from '../../store'
import type { EntityMissionTag } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'
import { AircraftOverview } from './entity/AircraftOverview'
import { VesselOverview } from './entity/VesselOverview'
import { AprsOverview } from './entity/AprsOverview'
import { StreamGaugeOverview } from './entity/StreamGaugeOverview'
import { TrainOverview } from './entity/TrainOverview'
import { GenericOverview } from './entity/GenericOverview'

interface MeshNeighbor {
  node_a: string
  node_b: string
  snr: number | null
  link_quality: number | null
}

const TYPE_COLORS: Record<string, string> = {
  aircraft:       'text-cyan-adsb',
  vessel:         'text-green-ais',
  train:          'text-amber-gold',
  mesh_node:      'text-amber-p25',
  satellite:      'text-violet-space',
  tinygs_station: 'text-amber-p25',
  aprs:           'text-cyan-adsb',
  fire_incident:  'text-red-emergency',
  hazard:         'text-red-emergency',
}

const TYPE_ICONS: Record<string, string> = {
  aircraft:       'flight',
  vessel:         'sailing',
  train:          'directions_railway',
  aprs:           'sensors',
  hazard:         'local_fire_department',
  fire_incident:  'local_fire_department',
  mesh_node:      'hub',
  satellite:      'satellite_alt',
  tinygs_station: 'settings_input_antenna',
  stream_gauge:   'waves',
}

const TAG_PRESETS = ['#FF4444', '#FF8800', '#FFB800', '#44DD88', '#00BBFF', '#AA44FF', '#FF44AA']



export function EntityDetail() {
  const {
    entities, airports, selectedEntityId, selectEntity,
    entityMissionTags, setEntityMissionTags, addEntityMissionTag, removeEntityMissionTag,
  } = useCivicStore()
  const entity = selectedEntityId ? entities[selectedEntityId] : null

  // Fetch trail for sparklines (aircraft only)
  const [trail, setTrail] = useState<{ altitude?: number | null; speed?: number | null }[]>([])
  useEffect(() => {
    if (!selectedEntityId || !entity || entity.entity_type !== 'aircraft') {
      setTrail([])
      return
    }
    let cancelled = false
    fetch(`${API_BASE}/entities/${encodeURIComponent(selectedEntityId)}/trail?minutes=30`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : [])
      .then((pts: { altitude?: number | null; speed?: number | null }[]) => {
        if (!cancelled) setTrail(pts)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedEntityId, entity?.entity_type])

  // Fetch mesh neighbors for mesh_node entities
  const [meshNeighbors, setMeshNeighbors] = useState<MeshNeighbor[]>([])
  useEffect(() => {
    if (!selectedEntityId || !entity || entity.entity_type !== 'mesh_node') {
      setMeshNeighbors([])
      return
    }
    let cancelled = false
    fetch(`${API_BASE}/mesh/links?stale_minutes=60`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : [])
      .then((links: MeshNeighbor[]) => {
        if (!cancelled) {
          setMeshNeighbors(
            links.filter(
              (l) => l.node_a === selectedEntityId || l.node_b === selectedEntityId
            )
          )
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedEntityId, entity?.entity_type])

  // Load mission tags when entity changes
  const loadTags = useCallback(async (entityId: string) => {
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/tags`, { headers: authHeaders() })
      if (!res.ok) return
      const data: EntityMissionTag[] = await res.json()
      setEntityMissionTags(entityId, data)
    } catch { /* non-fatal */ }
  }, [setEntityMissionTags])

  useEffect(() => {
    if (selectedEntityId) loadTags(selectedEntityId)
  }, [selectedEntityId, loadTags])

  // Tag editor state
  const [tagInput, setTagInput] = useState('')
  const [tagColor, setTagColor] = useState('#FFB800')
  const [tagSaving, setTagSaving] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)

  // Tab state
  const [activeTab, setActiveTab] = useState<'overview' | 'weather' | 'tags'>('overview')

  // Reset tab to overview if switching from aircraft (which has weather) to non-aircraft
  useEffect(() => {
    if (activeTab === 'weather' && entity?.entity_type !== 'aircraft') {
      setActiveTab('overview')
    }
  }, [entity?.entity_type, activeTab])

  const handleAddTag = async () => {
    if (!selectedEntityId || !tagInput.trim()) return
    setTagSaving(true)
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(selectedEntityId)}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ tag: tagInput.trim(), color: tagColor }),
      })
      if (res.ok) {
        const created: EntityMissionTag = await res.json()
        addEntityMissionTag(created)
        setTagInput('')
        setShowColorPicker(false)
      }
    } catch { /* non-fatal */ }
    setTagSaving(false)
  }

  const handleDeleteTag = async (tagId: number) => {
    if (!selectedEntityId) return
    try {
      await fetch(`${API_BASE}/entities/${encodeURIComponent(selectedEntityId)}/tags/${tagId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      removeEntityMissionTag(selectedEntityId, tagId)
    } catch { /* non-fatal */ }
  }

  if (!entity) return null

  const identity = entity.identity ?? {}
  const getIdentity = (key: string): string | undefined => {
    const val = identity[key]
    if (typeof val === 'string' && val.trim()) return val
    if (typeof val === 'number') return String(val)
    return undefined
  }

  const colorClass = TYPE_COLORS[entity.entity_type] ?? 'text-amber-gold'
  const icon       = TYPE_ICONS[entity.entity_type]  ?? 'location_on'

  const missionTags = selectedEntityId ? (entityMissionTags[selectedEntityId] ?? []) : []

  // Weather data (only for aircraft)
  const origin = getIdentity('origin')
  const destination = getIdentity('destination')
  const originMetar = origin ? (airports[origin]?.metar as Record<string, unknown> | null | undefined) : undefined
  const destinationMetar = destination ? (airports[destination]?.metar as Record<string, unknown> | null | undefined) : undefined
  const originWx = originMetar && typeof originMetar.raw === 'string' ? originMetar.raw : undefined
  const destinationWx = destinationMetar && typeof destinationMetar.raw === 'string' ? destinationMetar.raw : undefined

  return (
    <aside
      className="absolute top-24 lg:top-28 left-0 lg:left-auto right-0 lg:right-4 hud-panel w-full lg:w-80 z-[60] flex flex-col max-h-[55vh] lg:max-h-[calc(100vh-8rem)]"
      aria-label={`Entity detail: ${entity.display_name ?? entity.entity_id}`}
      role="complementary"
    >
      {/* Header */}
      <div className="p-3 border-b border-amber-gold-muted bg-onyx-deep/80 shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`ms text-[20px] leading-none shrink-0 ${colorClass}`}
              aria-hidden="true"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {icon}
            </span>
            <span className="font-bold text-[14px] tracking-wide text-on-surface uppercase truncate">
              {entity.display_name ?? entity.entity_id}
            </span>
          </div>
          <button
            onClick={() => selectEntity(null)}
            className="text-on-surface-variant hover:text-amber-gold transition-colors shrink-0 p-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
            aria-label="Close entity detail"
          >
            <span className="ms text-[18px] leading-none">close</span>
          </button>
        </div>
        
        {/* Tabs */}
        <div className="flex gap-4 border-b border-white/10">
          {(['overview', 'weather', 'tags'] as const).map(tab => {
            if (tab === 'weather' && entity.entity_type !== 'aircraft') return null
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`uppercase tracking-widest text-[11px] font-bold pb-1.5 border-b-2 transition-colors ${
                  activeTab === tab 
                    ? 'border-amber-gold text-amber-gold' 
                    : 'border-transparent text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {tab}
              </button>
            )
          })}
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="overflow-y-auto overflow-x-hidden p-3 space-y-4 flex-1 custom-scrollbar">
        
        {activeTab === 'overview' && (
          <>
            {entity.entity_type === 'aircraft' ? (
              <AircraftOverview entity={entity} getIdentity={getIdentity} trail={trail} />
            ) : entity.entity_type === 'vessel' ? (
              <VesselOverview entity={entity} getIdentity={getIdentity} />
            ) : entity.entity_type === 'train' ? (
              <TrainOverview entity={entity} getIdentity={getIdentity} />
            ) : entity.entity_type === 'aprs' ? (
              <AprsOverview entity={entity} getIdentity={getIdentity} />
            ) : entity.entity_type === 'stream_gauge' ? (
              <StreamGaugeOverview entity={entity} getIdentity={getIdentity} />
            ) : (
              <GenericOverview entity={entity} getIdentity={getIdentity} />
            )}

            {entity.entity_type === 'mesh_node' && (() => {
              const batteryLevel = typeof identity.battery_level === 'number' ? identity.battery_level as number : null
              const voltage = typeof identity.voltage === 'number' ? identity.voltage as number : null
              const nodeSnr = typeof identity.snr === 'number' ? identity.snr as number : null
              const batColor = batteryLevel == null ? '#999'
                : batteryLevel >= 60 ? '#44dd88'
                : batteryLevel >= 30 ? '#ffb800'
                : '#ff5050'
              return (
                <>
                  {(batteryLevel != null || nodeSnr != null) && (
                    <div>
                      <span className="label-caps text-[11px] text-amber-gold-dim mb-2 block">Radio / Power</span>
                      <div className="space-y-2">
                        {batteryLevel != null && (
                          <div>
                            <div className="flex justify-between mb-0.5">
                              <span className="text-[11px] text-on-surface-variant">Battery</span>
                              <span className="font-mono text-[11px]" style={{ color: batColor }}>
                                {batteryLevel}%{voltage != null ? ` · ${voltage.toFixed(2)}V` : ''}
                              </span>
                            </div>
                            <div className="h-1.5 bg-white/10 w-full overflow-hidden">
                              <div className="h-full" style={{ width: `${batteryLevel}%`, backgroundColor: batColor }} />
                            </div>
                          </div>
                        )}
                        {nodeSnr != null && (
                          <div className="flex justify-between">
                            <span className="text-[11px] text-on-surface-variant">Node SNR</span>
                            <span className="font-mono text-[11px]" style={{
                              color: nodeSnr >= -70 ? '#44dd88' : nodeSnr >= -90 ? '#ffb800' : '#ff5050',
                            }}>
                              {nodeSnr} dBm
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div>
                    <span className="label-caps text-[11px] text-amber-gold-dim mb-2 block">Neighbors</span>
                    {meshNeighbors.length === 0 ? (
                      <p className="text-[11px] text-on-surface-variant/50 italic">No active links</p>
                    ) : (
                      <ul className="space-y-1">
                        {meshNeighbors.map((lnk, i) => {
                          const peerId = lnk.node_a === selectedEntityId ? lnk.node_b : lnk.node_a
                          return (
                            <li key={i} className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[11px] text-on-surface truncate">{peerId}</span>
                              <span
                                className="font-mono text-[11px] shrink-0"
                                style={{
                                  color: lnk.snr === null ? '#999'
                                    : lnk.snr >= -70 ? '#44dd88'
                                    : lnk.snr >= -90 ? '#ffb800'
                                    : '#ff5050',
                                }}
                              >
                                {lnk.snr !== null ? `${lnk.snr} dBm` : '—'}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </>
              )
            })()}
          </>
        )}

        {activeTab === 'weather' && (
          <div className="space-y-4">
            {!originWx && !destinationWx ? (
              <div className="text-center p-4">
                <span className="ms text-[24px] text-on-surface-variant/50 mb-2 block">cloud_off</span>
                <p className="text-[11px] text-on-surface-variant uppercase tracking-widest">No weather data available</p>
              </div>
            ) : (
              <>
                {originWx && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2 text-cyan-adsb">
                      <span className="ms text-[14px]">flight_takeoff</span>
                      <span className="label-caps text-[11px]">Origin METAR ({origin})</span>
                    </div>
                    <div className="bg-[#0a0a0a] border border-white/10 p-2 font-mono text-[11px] text-[#00ffcc] leading-relaxed whitespace-pre-wrap break-words rounded-sm shadow-inner">
                      &gt; {originWx}
                    </div>
                  </div>
                )}
                
                {destinationWx && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2 text-amber-gold">
                      <span className="ms text-[14px]">flight_land</span>
                      <span className="label-caps text-[11px]">Destination METAR ({destination})</span>
                    </div>
                    <div className="bg-[#0a0a0a] border border-white/10 p-2 font-mono text-[11px] text-[#00ffcc] leading-relaxed whitespace-pre-wrap break-words rounded-sm shadow-inner">
                      &gt; {destinationWx}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'tags' && (
          <div className="space-y-4">
            {/* Source Tags */}
            {entity.tags && entity.tags.length > 0 && (
              <div>
                <span className="label-caps text-[11px] text-amber-gold-dim mb-2 block">Source Tags</span>
                <div className="flex flex-wrap gap-1">
                  {entity.tags.map((tag) => (
                    <span
                      key={tag}
                      className="font-mono text-[11px] uppercase tracking-widest px-1.5 py-0.5 bg-amber-gold-muted/40 text-amber-gold-dim rounded-sm"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Mission Tags */}
            <div>
              <span className="label-caps text-[11px] text-amber-gold-dim mb-2 block">Mission Tags</span>
              
              {missionTags.length === 0 ? (
                <p className="text-[11px] text-on-surface-variant/50 italic mb-3">No custom tags assigned</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {missionTags.map((t) => (
                    <div 
                      key={t.id} 
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm"
                      style={{ backgroundColor: `${t.color}15`, border: `1px solid ${t.color}40` }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }}></span>
                      <span className="font-mono text-[11px] uppercase tracking-widest" style={{ color: t.color }}>
                        {t.tag}
                      </span>
                      <button
                        onClick={() => handleDeleteTag(t.id)}
                        className="text-on-surface-variant hover:text-red-emergency transition-colors leading-none p-0.5 ml-1 focus:outline-none"
                        aria-label={`Remove tag ${t.tag}`}
                      >
                        <span className="ms text-[12px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Tag Editor */}
              <div className="space-y-2 bg-white/5 p-2 border border-white/10 rounded-sm">
                <div className="flex gap-1 relative">
                  <button 
                    onClick={() => setShowColorPicker(!showColorPicker)}
                    className="w-6 h-6 shrink-0 flex items-center justify-center border border-white/20 rounded-sm hover:bg-white/10 transition-colors"
                    aria-label="Pick color"
                  >
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tagColor }}></div>
                  </button>
                  <input
                    type="text"
                    placeholder="New mission tag…"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag() }}
                    className="flex-1 min-w-0 bg-transparent border-b text-on-surface placeholder-on-surface-variant text-[11px] px-1 focus:outline-none transition-colors"
                    style={{ borderBottomColor: tagInput.trim() ? tagColor : 'rgba(255,255,255,0.2)' }}
                  />
                  <button
                    onClick={handleAddTag}
                    disabled={tagSaving || !tagInput.trim()}
                    className="text-amber-gold hover:text-white px-1 transition-colors focus:outline-none disabled:opacity-30 disabled:hover:text-amber-gold"
                    aria-label="Add tag"
                  >
                    <span className="ms text-[16px] leading-none">add_circle</span>
                  </button>
                </div>
                
                {showColorPicker && (
                  <div className="flex gap-1.5 pt-2 border-t border-white/10">
                    {TAG_PRESETS.map((c) => (
                      <button
                        key={c}
                        onClick={() => { setTagColor(c); setShowColorPicker(false); }}
                        className="w-4 h-4 rounded-full transition-transform hover:scale-110 focus:outline-none"
                        style={{
                          backgroundColor: c,
                          boxShadow: tagColor === c ? `0 0 0 2px #050505, 0 0 0 3px ${c}` : 'none',
                        }}
                        aria-label={`Select color ${c}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
