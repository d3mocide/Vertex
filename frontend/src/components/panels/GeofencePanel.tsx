import { useState, useEffect, useCallback, useRef } from 'react'
import { useCivicStore, CustomLayerItem } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

interface GeofenceRecord {
  id: number
  name: string
  description?: string
  zone_type: string
  geofence_shape?: 'polygon' | 'circle'
  dwell_seconds?: number
  center_lat?: number | null
  center_lon?: number | null
  radius_m?: number | null
  active: boolean
  geojson_polygon: object
}

const ZONE_TYPES = ['alert', 'exclusion', 'info'] as const
type ZoneType = typeof ZONE_TYPES[number]

const ZONE_LABELS: Record<ZoneType, string> = {
  alert:     'Alert',
  exclusion: 'Exclusion',
  info:      'Info',
}
const ZONE_COLORS: Record<ZoneType, string> = {
  alert:     'text-amber-gold border-amber-gold/50',
  exclusion: 'text-red-emergency border-red-emergency/50',
  info:      'text-cyan-adsb border-cyan-adsb/50',
}

// ─── KML → GeoJSON conversion (browser-side, no npm dependency) ──────────────

function parseKmlCoords(text: string): [number, number][] {
  return text.trim().split(/\s+/)
    .map((c) => c.split(',').map(Number))
    .filter((p) => p.length >= 2 && !p.some(isNaN))
    .map((p) => [p[0], p[1]])
}

function kmlToGeoJson(kmlText: string): object {
  const parser = new DOMParser()
  const doc = parser.parseFromString(kmlText, 'text/xml')
  const features: object[] = []

  doc.querySelectorAll('Placemark').forEach((pm) => {
    const name = pm.querySelector('name')?.textContent ?? ''
    const props = { name }

    const polygon = pm.querySelector('Polygon')
    if (polygon) {
      const outer = polygon.querySelector('outerBoundaryIs coordinates')
      const coords = parseKmlCoords(outer?.textContent ?? '')
      if (coords.length >= 3) {
        features.push({
          type: 'Feature', properties: props,
          geometry: { type: 'Polygon', coordinates: [coords] },
        })
      }
    }

    const line = pm.querySelector('LineString')
    if (line) {
      const coords = parseKmlCoords(line.querySelector('coordinates')?.textContent ?? '')
      if (coords.length >= 2) {
        features.push({
          type: 'Feature', properties: props,
          geometry: { type: 'LineString', coordinates: coords },
        })
      }
    }

    const point = pm.querySelector('Point')
    if (point) {
      const coords = parseKmlCoords(point.querySelector('coordinates')?.textContent ?? '')
      if (coords.length >= 1) {
        features.push({
          type: 'Feature', properties: props,
          geometry: { type: 'Point', coordinates: coords[0] },
        })
      }
    }
  })

  return { type: 'FeatureCollection', features }
}

// ─── Component ────────────────────────────────────────────────────────────────

type PanelTab = 'geofences' | 'layers'

export function GeofencePanel() {
  const {
    geofenceDrawing, setGeofenceDrawing,
    geofenceDrawMode, setGeofenceDrawMode,
    geofenceDrawPoints, clearGeofenceDrawPoints,
    customLayers, setCustomLayers,
  } = useCivicStore()

  const [panelTab, setPanelTab] = useState<PanelTab>('geofences')
  const [fences, setFences]         = useState<GeofenceRecord[]>([])
  const [loading, setLoading]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)

  // Save-form state
  const [saveName, setSaveName]     = useState('')
  const [saveDesc, setSaveDesc]     = useState('')
  const [saveType, setSaveType]     = useState<ZoneType>('alert')
  const [saveDwellSeconds, setSaveDwellSeconds] = useState(0)
  const [showSaveForm, setShowSaveForm] = useState(false)

  // Custom layer import state
  const fileInputRef                = useRef<HTMLInputElement>(null)
  const [layerImportName, setLayerImportName] = useState('')
  const [layerImportGeoJson, setLayerImportGeoJson] = useState<object | null>(null)
  const [layerImportError, setLayerImportError] = useState<string | null>(null)
  const [layerSaving, setLayerSaving] = useState(false)
  const [dragOver, setDragOver]     = useState(false)

  const pointsNeeded = geofenceDrawMode === 'circle' ? 2 : 3

  // ── Geofence CRUD ────────────────────────────────────────────────────────────

  const loadFences = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/geofences`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setFences(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadFences() }, [loadFences])

  const startDraw = (mode: 'polygon' | 'circle') => {
    clearGeofenceDrawPoints()
    setGeofenceDrawMode(mode)
    setGeofenceDrawing(true)
    setShowSaveForm(false)
    setSaveName('')
    setSaveDesc('')
    setSaveType('alert')
    setSaveDwellSeconds(0)
  }

  const cancelDraw = () => {
    setGeofenceDrawing(false)
    clearGeofenceDrawPoints()
    setShowSaveForm(false)
  }

  const openSaveForm = () => {
    setGeofenceDrawing(false)
    setShowSaveForm(true)
  }

  const haversineMeters = (a: [number, number], b: [number, number]) => {
    const toRad = (d: number) => (d * Math.PI) / 180
    const R = 6371000
    const dLat = toRad(b[1] - a[1])
    const dLon = toRad(b[0] - a[0])
    const lat1 = toRad(a[1])
    const lat2 = toRad(b[1])
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }

  const saveGeofence = async () => {
    if (!saveName.trim()) { setError('Name required'); return }
    if (geofenceDrawPoints.length < pointsNeeded) {
      setError(`Need at least ${pointsNeeded} points`)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const isCircle = geofenceDrawMode === 'circle'
      const closed = [...geofenceDrawPoints, geofenceDrawPoints[0]]
      const center = geofenceDrawPoints[0]
      const edge = geofenceDrawPoints[1]
      const radiusM = isCircle && center && edge ? haversineMeters(center, edge) : null
      const res = await fetch(`${API_BASE}/geofences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: saveName.trim(),
          description: saveDesc.trim() || null,
          zone_type: saveType,
          geofence_shape: geofenceDrawMode,
          dwell_seconds: Math.max(0, saveDwellSeconds),
          center_lat: isCircle && center ? center[1] : null,
          center_lon: isCircle && center ? center[0] : null,
          radius_m: isCircle ? radiusM : null,
          active: true,
          geojson_polygon: isCircle ? null : {
            type: 'Polygon',
            coordinates: [closed],
          },
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `HTTP ${res.status}`)
      }
      clearGeofenceDrawPoints()
      setShowSaveForm(false)
      setSaveName('')
      setSaveDesc('')
      setSaveType('alert')
      await loadFences()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const deleteGeofence = async (id: number) => {
    try {
      await fetch(`${API_BASE}/geofences/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      await loadFences()
    } catch {
      setError('Delete failed')
    }
  }

  // ── Custom layer CRUD ────────────────────────────────────────────────────────

  const loadCustomLayers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/layers`, { headers: authHeaders() })
      if (res.ok) setCustomLayers(await res.json())
    } catch { /* ignore */ }
  }, [setCustomLayers])

  useEffect(() => { loadCustomLayers() }, [loadCustomLayers])

  const processFile = async (file: File) => {
    setLayerImportError(null)
    setLayerImportGeoJson(null)
    const text = await file.text()
    try {
      let geojson: object
      if (file.name.endsWith('.kml')) {
        geojson = kmlToGeoJson(text)
      } else {
        geojson = JSON.parse(text) as object
      }
      setLayerImportGeoJson(geojson)
      if (!layerImportName) setLayerImportName(file.name.replace(/\.(kml|geojson|json)$/i, ''))
    } catch {
      setLayerImportError('Could not parse file — must be valid KML, GeoJSON, or JSON.')
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const saveCustomLayer = async () => {
    if (!layerImportGeoJson || !layerImportName.trim()) return
    setLayerSaving(true)
    setLayerImportError(null)
    try {
      const res = await fetch(`${API_BASE}/layers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: layerImportName.trim(), geojson: layerImportGeoJson, visible: true }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setLayerImportGeoJson(null)
      setLayerImportName('')
      await loadCustomLayers()
    } catch (e) {
      setLayerImportError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setLayerSaving(false)
    }
  }

  const toggleLayerVisibility = async (layer: CustomLayerItem) => {
    try {
      await fetch(`${API_BASE}/layers/${layer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ visible: !layer.visible }),
      })
      await loadCustomLayers()
    } catch { /* ignore */ }
  }

  const deleteCustomLayer = async (id: number) => {
    try {
      await fetch(`${API_BASE}/layers/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      await loadCustomLayers()
    } catch { /* ignore */ }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Panel tabs */}
      <div className="flex border-b border-white/10">
        {(['geofences', 'layers'] as PanelTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setPanelTab(tab)}
            className={`px-3 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors focus:outline-none ${
              panelTab === tab
                ? 'text-amber-gold border-b-2 border-amber-gold'
                : 'text-on-surface-variant hover:text-on-surface border-b-2 border-transparent'
            }`}
          >
            {tab === 'geofences' ? `Geofences (${fences.length})` : `Custom Layers (${customLayers.length})`}
          </button>
        ))}
      </div>

      {/* ── Geofences Tab ─────────────────────────────────────────────────── */}
      {panelTab === 'geofences' && (
        <>
          {/* Draw toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {!geofenceDrawing && !showSaveForm && (
              <>
                <button
                  onClick={() => startDraw('polygon')}
                  className="flex items-center gap-2 px-3 py-1.5 border border-amber-gold/60 text-amber-gold text-[10px] font-bold uppercase tracking-widest hover:bg-amber-gold/10 transition-colors focus:outline-none"
                >
                  <span className="ms text-[14px] leading-none">pentagon</span>
                  Draw Polygon
                </button>
                <button
                  onClick={() => startDraw('circle')}
                  className="flex items-center gap-2 px-3 py-1.5 border border-cyan-adsb/60 text-cyan-adsb text-[10px] font-bold uppercase tracking-widest hover:bg-cyan-adsb/10 transition-colors focus:outline-none"
                >
                  <span className="ms text-[14px] leading-none">circle</span>
                  Draw Circle
                </button>
              </>
            )}

            {geofenceDrawing && (
              <>
                <div className="flex items-center gap-2 text-[10px] text-amber-gold border border-amber-gold/30 px-3 py-1.5 bg-amber-gold/5">
                  <span className="ms text-[14px] leading-none animate-pulse">touch_app</span>
                  Click map to add points ({geofenceDrawPoints.length}/{pointsNeeded})
                </div>
                {geofenceDrawPoints.length >= pointsNeeded && (
                  <button
                    onClick={openSaveForm}
                    className="flex items-center gap-2 px-3 py-1.5 border border-amber-gold text-amber-gold text-[10px] font-bold uppercase tracking-widest bg-amber-gold/10 hover:bg-amber-gold/20 transition-colors focus:outline-none"
                  >
                    <span className="ms text-[14px] leading-none">check</span>
                    Finish
                  </button>
                )}
                <button
                  onClick={cancelDraw}
                  className="flex items-center gap-2 px-3 py-1.5 border border-white/20 text-on-surface-variant text-[10px] uppercase tracking-widest hover:border-white/40 transition-colors focus:outline-none"
                >
                  <span className="ms text-[14px] leading-none">close</span>
                  Cancel
                </button>
              </>
            )}
          </div>

          {/* Save form */}
          {showSaveForm && (
            <div className="border border-amber-gold/30 bg-amber-gold/5 p-4 space-y-3">
              <span className="label-caps text-[9px] text-amber-gold block">
                Save Geofence ({geofenceDrawMode === 'circle' ? 'circle' : `${geofenceDrawPoints.length} vertices`})
              </span>

              <input
                type="text"
                placeholder="Zone name *"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="w-full bg-onyx-deep border border-white/10 text-on-surface placeholder-on-surface-variant text-[11px] px-3 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={saveDesc}
                onChange={(e) => setSaveDesc(e.target.value)}
                className="w-full bg-onyx-deep border border-white/10 text-on-surface placeholder-on-surface-variant text-[11px] px-3 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
              />

              <div>
                <span className="text-[9px] text-on-surface-variant uppercase tracking-widest">Dwell Seconds</span>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={saveDwellSeconds}
                  onChange={(e) => setSaveDwellSeconds(Number(e.target.value || 0))}
                  className="w-full mt-1 bg-onyx-deep border border-white/10 text-on-surface text-[11px] px-3 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
                />
              </div>

              <div className="flex gap-1">
                {ZONE_TYPES.map((zt) => (
                  <button
                    key={zt}
                    onClick={() => setSaveType(zt)}
                    className={`flex-1 py-1 border text-[9px] font-bold uppercase tracking-widest transition-colors focus:outline-none ${
                      saveType === zt
                        ? ZONE_COLORS[zt] + ' bg-current/10'
                        : 'border-white/10 text-on-surface-variant hover:border-white/20'
                    }`}
                    aria-pressed={saveType === zt}
                  >
                    {ZONE_LABELS[zt]}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={saveGeofence}
                  disabled={saving || !saveName.trim()}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-amber-gold/10 border border-amber-gold/60 text-amber-gold text-[10px] font-bold uppercase tracking-widest hover:bg-amber-gold/20 transition-colors focus:outline-none disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={cancelDraw}
                  className="px-3 py-1.5 border border-white/10 text-on-surface-variant text-[10px] uppercase tracking-widest hover:border-white/20 transition-colors focus:outline-none"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-[10px] text-red-emergency">{error}</p>}

          {/* Geofence list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="label-caps text-[9px]">Active Zones ({fences.length})</span>
              <button onClick={loadFences} disabled={loading} className="ms text-[14px] text-on-surface-variant hover:text-on-surface transition-colors leading-none focus:outline-none" title="Refresh">
                sync
              </button>
            </div>

            {fences.length === 0 ? (
              <p className="text-[11px] text-on-surface-variant italic">No geofences defined.</p>
            ) : (
              <div className="space-y-2">
                {fences.map((f) => (
                  <div key={f.id} className="flex items-start gap-3 p-2 border border-white/5 bg-onyx-deep/40 hover:bg-surface-container transition-colors">
                    <span className={`mt-0.5 font-mono text-[8px] border px-1 py-0.5 uppercase tracking-widest shrink-0 ${ZONE_COLORS[f.zone_type as ZoneType] ?? ZONE_COLORS.alert}`}>
                      {ZONE_LABELS[f.zone_type as ZoneType] ?? f.zone_type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-on-surface font-bold truncate">{f.name}</div>
                      {f.description && (
                        <div className="text-[10px] text-on-surface-variant truncate">{f.description}</div>
                      )}
                      <div className="text-[9px] text-on-surface-variant uppercase tracking-widest mt-0.5">
                        {(f.geofence_shape ?? 'polygon')} · dwell {Math.max(0, f.dwell_seconds ?? 0)}s
                      </div>
                    </div>
                    <button
                      onClick={() => deleteGeofence(f.id)}
                      className="ms text-[16px] text-on-surface-variant hover:text-red-emergency transition-colors leading-none shrink-0 focus:outline-none"
                      title={`Delete ${f.name}`}
                    >
                      delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Custom Layers Tab ──────────────────────────────────────────────── */}
      {panelTab === 'layers' && (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors
              ${dragOver
                ? 'border-amber-gold bg-amber-gold/10 text-amber-gold'
                : 'border-white/20 hover:border-white/40 text-on-surface-variant'
              }
            `}
          >
            <span className="ms text-[32px] leading-none" aria-hidden="true">upload_file</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">
              Drop KML, GeoJSON, or JSON
            </span>
            <span className="text-[9px] opacity-60">or click to browse</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".kml,.geojson,.json"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Import form — shown after file is parsed */}
          {layerImportGeoJson && (
            <div className="border border-amber-gold/30 bg-amber-gold/5 p-3 space-y-2">
              <span className="label-caps text-[9px] text-amber-gold block">Name this layer</span>
              <input
                type="text"
                placeholder="Layer name *"
                value={layerImportName}
                onChange={(e) => setLayerImportName(e.target.value)}
                className="w-full bg-onyx-deep border border-white/10 text-on-surface placeholder-on-surface-variant text-[11px] px-3 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
              />
              {layerImportError && <p className="text-[9px] text-red-emergency">{layerImportError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={saveCustomLayer}
                  disabled={layerSaving || !layerImportName.trim()}
                  className="flex-1 py-1.5 bg-amber-gold/10 border border-amber-gold/60 text-amber-gold text-[10px] font-bold uppercase tracking-widest hover:bg-amber-gold/20 transition-colors focus:outline-none disabled:opacity-50"
                >
                  {layerSaving ? 'Saving…' : 'Add to Map'}
                </button>
                <button
                  onClick={() => { setLayerImportGeoJson(null); setLayerImportName(''); setLayerImportError(null) }}
                  className="px-3 py-1.5 border border-white/10 text-on-surface-variant text-[10px] uppercase tracking-widest hover:border-white/20 transition-colors focus:outline-none"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {layerImportError && !layerImportGeoJson && (
            <p className="text-[10px] text-red-emergency">{layerImportError}</p>
          )}

          {/* Layer list */}
          {customLayers.length === 0 ? (
            <p className="text-[11px] text-on-surface-variant italic">No custom layers imported yet.</p>
          ) : (
            <div className="space-y-2">
              {customLayers.map((layer) => (
                <div key={layer.id} className="flex items-center gap-3 p-2 border border-white/5 bg-onyx-deep/40 hover:bg-surface-container transition-colors">
                  <button
                    onClick={() => toggleLayerVisibility(layer)}
                    title={layer.visible ? 'Visible — click to hide' : 'Hidden — click to show'}
                    className={`ms text-[18px] leading-none transition-colors focus:outline-none shrink-0 ${
                      layer.visible ? 'text-amber-gold' : 'text-on-surface-variant/30'
                    }`}
                    style={{ fontVariationSettings: layer.visible ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {layer.visible ? 'visibility' : 'visibility_off'}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-on-surface font-bold truncate">{layer.name}</div>
                    <div className="text-[9px] text-on-surface-variant uppercase tracking-widest">
                      {'features' in (layer.geojson as Record<string, unknown>)
                        ? `${((layer.geojson as { features: unknown[] }).features ?? []).length} feature(s)`
                        : 'GeoJSON'}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteCustomLayer(layer.id)}
                    className="ms text-[16px] text-on-surface-variant hover:text-red-emergency transition-colors leading-none shrink-0 focus:outline-none"
                    title={`Delete ${layer.name}`}
                  >
                    delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
