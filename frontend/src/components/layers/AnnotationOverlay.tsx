import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import type { AnnotationItem } from '../../storeTypes'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

const COLOR_PRESETS = ['#FF4444', '#FF8800', '#FFB800', '#44DD88', '#00BBFF', '#AA44FF', '#FF44AA']
const SRC_DRAW      = 'annotation-draw-source'

function expiryToIso(expiry: string): string | null {
  const hours: Record<string, number> = { '4h': 4, '12h': 12, '24h': 24 }
  const h = hours[expiry]
  return h != null ? new Date(Date.now() + h * 3_600_000).toISOString() : null
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return 'Permanent'
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return 'Expired'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h >= 48) return `${Math.floor(h / 24)}d`
  if (h > 0)   return `${h}h ${m}m`
  return `${m}m`
}

const TYPE_ICON: Record<string, string> = {
  marker: 'room',
  line:   'polyline',
  polygon: 'pentagon',
}

interface Props { map: maplibregl.Map }

export function AnnotationOverlay({ map }: Props) {
  const annotations            = useCivicStore((s) => s.annotations)
  const setAnnotations         = useCivicStore((s) => s.setAnnotations)
  const addAnnotation          = useCivicStore((s) => s.addAnnotation)
  const updateAnnotation       = useCivicStore((s) => s.updateAnnotation)
  const removeAnnotation       = useCivicStore((s) => s.removeAnnotation)
  const annotationDrawMode     = useCivicStore((s) => s.annotationDrawMode)
  const setAnnotationDrawMode  = useCivicStore((s) => s.setAnnotationDrawMode)
  const setAnnotationDrawPreview    = useCivicStore((s) => s.setAnnotationDrawPreview)
  const clearAnnotationDrawPreview  = useCivicStore((s) => s.clearAnnotationDrawPreview)
  const annotationsVisible     = useCivicStore((s) => s.annotationsVisible)
  const setAnnotationsVisible  = useCivicStore((s) => s.setAnnotationsVisible)
  const toolbarOpen            = useCivicStore((s) => s.annotationToolbarOpen)
  const setToolbarOpen         = useCivicStore((s) => s.setAnnotationToolbarOpen)

  // Draw refs
  const drawModeRef   = useRef<'marker' | 'line' | 'polygon' | null>(null)
  const drawPointsRef = useRef<[number, number][]>([])
  const cursorPtRef   = useRef<[number, number] | null>(null)

  const [drawPoints, setDrawPoints] = useState<[number, number][]>([])

  // Save/edit form state (shared for create and edit)
  const [pendingGeom,  setPendingGeom]  = useState<GeoJSON.Geometry | null>(null)
  const [editingAnnot, setEditingAnnot] = useState<AnnotationItem | null>(null)
  const [saveLabel,    setSaveLabel]    = useState('')
  const [saveColor,    setSaveColor]    = useState('#FFB800')
  const [saveExpiry,   setSaveExpiry]   = useState('permanent')
  const [saving,       setSaving]       = useState(false)

  // Click popup state — stores id + screen position
  const [popupAnnotId, setPopupAnnotId] = useState<number | null>(null)
  const [popupPos,     setPopupPos]     = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const popupAnnot = annotations.find((a) => a.id === popupAnnotId) ?? null

  // List panel toggle
  const [showList, setShowList] = useState(false)

  // Load saved annotations on mount
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/annotations`, { headers: authHeaders() })
        if (!res.ok) return
        const data = await res.json()
        if (Array.isArray(data)) setAnnotations(data)
      } catch { /* non-fatal */ }
    }
    load()
  }, [setAnnotations])

  // Keep drawModeRef in sync
  useEffect(() => { drawModeRef.current = annotationDrawMode }, [annotationDrawMode])

  // Cursor while drawing
  useEffect(() => {
    map.getCanvas().style.cursor = annotationDrawMode ? 'crosshair' : ''
  }, [map, annotationDrawMode])

  // Update draw preview source
  const updateDrawSource = useCallback(() => {
    const src = map.getSource(SRC_DRAW) as maplibregl.GeoJSONSource | undefined
    if (!src) return
    const mode   = drawModeRef.current
    const pts    = drawPointsRef.current
    const cursor = cursorPtRef.current
    if (!mode || pts.length === 0) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    const features: GeoJSON.Feature[] = pts.map((p) => ({
      type: 'Feature', properties: {},
      geometry: { type: 'Point', coordinates: p },
    }))
    const preview = cursor ? [...pts, cursor] : pts
    if (mode === 'line' && preview.length >= 2) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: preview } })
    } else if (mode === 'polygon' && preview.length >= 2) {
      features.push({
        type: 'Feature', properties: {},
        geometry: preview.length >= 3
          ? { type: 'Polygon', coordinates: [[...preview, preview[0]]] }
          : { type: 'LineString', coordinates: preview },
      })
    }
    src.setData({ type: 'FeatureCollection', features })
  }, [map])

  const clearDrawSource = useCallback(() => {
    const src = map.getSource(SRC_DRAW) as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features: [] })
  }, [map])

  const finalizeDraw = useCallback((mode: 'line' | 'polygon', pts: [number, number][]) => {
    const geom: GeoJSON.Geometry = mode === 'line'
      ? { type: 'LineString', coordinates: pts }
      : { type: 'Polygon',    coordinates: [[...pts, pts[0]]] }
    setPendingGeom(geom)
    setAnnotationDrawMode(null)
    drawPointsRef.current = []
    cursorPtRef.current   = null
    setDrawPoints([])
    clearAnnotationDrawPreview()
    clearDrawSource()
    map.getCanvas().style.cursor = ''
  }, [map, setAnnotationDrawMode, clearDrawSource, clearAnnotationDrawPreview])

  // Setup MapLibre draw preview source
  useEffect(() => {
    const setup = () => {
      if (map.getSource(SRC_DRAW)) return
      map.addSource(SRC_DRAW, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'annotation-draw-fill', type: 'fill', source: SRC_DRAW, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#FFB800', 'fill-opacity': 0.1 } })
      map.addLayer({ id: 'annotation-draw-line', type: 'line', source: SRC_DRAW, filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#FFB800', 'line-width': 2, 'line-dasharray': [4, 2] } })
      map.addLayer({ id: 'annotation-draw-points', type: 'circle', source: SRC_DRAW, filter: ['==', '$type', 'Point'], paint: { 'circle-color': '#FFB800', 'circle-radius': 4, 'circle-stroke-color': '#000000', 'circle-stroke-width': 1 } })
    }
    if (map.isStyleLoaded()) setup()
    else map.once('load', setup)
    return () => {
      if (!map || typeof map.getLayer !== 'function') return
      for (const id of ['annotation-draw-points', 'annotation-draw-line', 'annotation-draw-fill']) {
        try { if (map.getLayer(id)) map.removeLayer(id) } catch { /* ignore */ }
      }
      try { if (map.getSource(SRC_DRAW)) map.removeSource(SRC_DRAW) } catch { /* ignore */ }
    }
  }, [map])

  // Draw interaction
  useEffect(() => {
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const mode = drawModeRef.current
      if (!mode) return
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      if (mode === 'marker') {
        setPendingGeom({ type: 'Point', coordinates: pt })
        setAnnotationDrawMode(null)
        drawPointsRef.current = []
        cursorPtRef.current   = null
        setDrawPoints([])
        clearAnnotationDrawPreview()
        clearDrawSource()
        map.getCanvas().style.cursor = ''
        return
      }
      const newPts: [number, number][] = [...drawPointsRef.current, pt]
      drawPointsRef.current = newPts
      setDrawPoints([...newPts])
      setAnnotationDrawPreview(newPts, cursorPtRef.current)
      updateDrawSource()
    }
    const handleDblClick = (e: maplibregl.MapMouseEvent) => {
      const mode = drawModeRef.current
      if (!mode || mode === 'marker') return
      e.preventDefault()
      const pts = drawPointsRef.current.slice(0, -1)
      if (mode === 'line' && pts.length >= 2) finalizeDraw(mode, pts)
      else if (mode === 'polygon' && pts.length >= 3) finalizeDraw(mode, pts)
    }
    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (drawModeRef.current === 'marker') return
      cursorPtRef.current = [e.lngLat.lng, e.lngLat.lat]
      setAnnotationDrawPreview(drawPointsRef.current, cursorPtRef.current)
      updateDrawSource()
    }
    if (annotationDrawMode) {
      map.on('click',    handleClick)
      map.on('dblclick', handleDblClick)
      if (annotationDrawMode !== 'marker') {
        setAnnotationDrawPreview(drawPointsRef.current, cursorPtRef.current)
        map.on('mousemove', handleMouseMove)
      } else {
        clearAnnotationDrawPreview()
      }
    } else {
      clearAnnotationDrawPreview()
    }
    return () => {
      map.off('click',     handleClick)
      map.off('dblclick',  handleDblClick)
      map.off('mousemove', handleMouseMove)
    }
  }, [map, annotationDrawMode, updateDrawSource, finalizeDraw, setAnnotationDrawMode, clearDrawSource, setAnnotationDrawPreview, clearAnnotationDrawPreview])

  // Click on existing annotation → show popup
  useEffect(() => {
    const handleAnnotClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (drawModeRef.current) return
      const feature = e.features?.[0]
      if (!feature) return
      const { id } = feature.properties as { id: number }
      setPopupAnnotId(id)
      setPopupPos({ x: e.point.x, y: e.point.y })
    }
    const enterCursor = () => { if (!drawModeRef.current) map.getCanvas().style.cursor = 'pointer' }
    const leaveCursor = () => { if (!drawModeRef.current) map.getCanvas().style.cursor = '' }
    const layers = ['annotation-polygon-fill', 'annotation-line', 'annotation-marker']
    for (const id of layers) {
      map.on('click',      id, handleAnnotClick)
      map.on('mouseenter', id, enterCursor)
      map.on('mouseleave', id, leaveCursor)
    }
    return () => {
      for (const id of layers) {
        map.off('click',      id, handleAnnotClick)
        map.off('mouseenter', id, enterCursor)
        map.off('mouseleave', id, leaveCursor)
      }
    }
  }, [map])

  const cancelDraw = useCallback(() => {
    setAnnotationDrawMode(null)
    drawPointsRef.current = []
    cursorPtRef.current   = null
    setDrawPoints([])
    clearAnnotationDrawPreview()
    clearDrawSource()
    map.getCanvas().style.cursor = ''
  }, [map, setAnnotationDrawMode, clearDrawSource, clearAnnotationDrawPreview])

  const finishDraw = () => {
    const mode = annotationDrawMode
    const pts  = drawPointsRef.current
    if (!mode || mode === 'marker') return
    if (mode === 'line'    && pts.length >= 2) finalizeDraw(mode, pts)
    if (mode === 'polygon' && pts.length >= 3) finalizeDraw(mode, pts)
  }

  // Open edit form pre-populated for an existing annotation
  const openEdit = (ann: AnnotationItem) => {
    setEditingAnnot(ann)
    setSaveLabel(ann.label ?? '')
    setSaveColor(ann.color)
    setSaveExpiry('permanent')
    setPopupAnnotId(null)
  }

  const cancelForm = () => {
    setPendingGeom(null)
    setEditingAnnot(null)
    setSaveLabel('')
    setSaveColor('#FFB800')
    setSaveExpiry('permanent')
  }

  const saveAnnotation = async () => {
    if (!pendingGeom && !editingAnnot) return
    setSaving(true)
    try {
      if (editingAnnot) {
        // Update existing
        const body: Record<string, unknown> = {
          label: saveLabel.trim() || null,
          color: saveColor,
        }
        if (saveExpiry === 'permanent') {
          body.clear_expiry = true
        } else {
          body.expires_at = expiryToIso(saveExpiry)
        }
        const res = await fetch(`${API_BASE}/annotations/${editingAnnot.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(body),
        })
        if (res.ok) {
          const item: AnnotationItem = await res.json()
          updateAnnotation(item)
          cancelForm()
        }
      } else if (pendingGeom) {
        // Create new
        const annotation_type =
          pendingGeom.type === 'Point'      ? 'marker'
          : pendingGeom.type === 'LineString' ? 'line'
          : 'polygon'
        const res = await fetch(`${API_BASE}/annotations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            annotation_type,
            label:      saveLabel.trim() || null,
            color:      saveColor,
            geojson:    pendingGeom,
            expires_at: expiryToIso(saveExpiry),
          }),
        })
        if (res.ok) {
          const item: AnnotationItem = await res.json()
          addAnnotation(item)
          cancelForm()
        }
      }
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await fetch(`${API_BASE}/annotations/${id}`, { method: 'DELETE', headers: authHeaders() })
      removeAnnotation(id)
      setPopupAnnotId(null)
    } catch { /* non-fatal */ }
  }

  const isDoneEnabled =
    annotationDrawMode === 'line'    ? drawPoints.length >= 2 :
    annotationDrawMode === 'polygon' ? drawPoints.length >= 3 : false

  const btnBase = 'flex items-center justify-center w-8 h-8 border transition-colors focus:outline-none'
  const btnOn   = `${btnBase} border-amber-gold/60 text-amber-gold bg-amber-gold/10`
  const btnOff  = `${btnBase} border-white/10 text-on-surface-variant hover:border-amber-gold/40 hover:text-amber-gold`

  const showForm = !!(pendingGeom || editingAnnot)

  return (
    <>
      {/* Draw / manage toolbar */}
      {(toolbarOpen || annotationDrawMode) && !showForm && (
        <div className="absolute top-40 left-[500px] flex flex-col z-[30] pointer-events-auto select-none">
          {/* Button row */}
          <div className="flex items-center gap-1 bg-onyx-black/95 border border-amber-gold-muted px-2 py-1.5 shadow-2xl">
            {/* Visibility toggle */}
            <button
              onClick={() => setAnnotationsVisible(!annotationsVisible)}
              className={annotationsVisible ? btnOn : btnOff}
              title={annotationsVisible ? 'Hide annotations' : 'Show annotations'}
            >
              <span className="ms text-[16px]">{annotationsVisible ? 'visibility' : 'visibility_off'}</span>
            </button>

            <div className="w-px h-4 bg-white/10 mx-0.5" />

            {annotationDrawMode === null ? (
              <>
                <button onClick={() => setAnnotationDrawMode('marker')} className={btnOff} title="Place marker">
                  <span className="ms text-[16px]">room</span>
                </button>
                <button onClick={() => setAnnotationDrawMode('line')} className={btnOff} title="Draw line">
                  <span className="ms text-[16px]">polyline</span>
                </button>
                <button onClick={() => setAnnotationDrawMode('polygon')} className={btnOff} title="Draw area">
                  <span className="ms text-[16px]">pentagon</span>
                </button>

                <div className="w-px h-4 bg-white/10 mx-0.5" />

                {/* List toggle */}
                <button
                  onClick={() => setShowList((v) => !v)}
                  className={showList ? btnOn : btnOff}
                  title="Manage annotations"
                >
                  <span className="ms text-[16px]">list</span>
                </button>

                {annotations.length > 0 && (
                  <span className="text-[9px] text-amber-gold/60 tabular-nums ml-0.5">
                    {annotations.length}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="text-[9px] text-amber-gold uppercase tracking-widest mr-1 whitespace-nowrap">
                  {annotationDrawMode === 'marker'
                    ? 'Click to place'
                    : `${drawPoints.length} pts · dbl-click to finish`}
                </span>
                {isDoneEnabled && (
                  <button
                    onClick={finishDraw}
                    className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 transition-colors focus:outline-none"
                  >
                    Done
                  </button>
                )}
                <button
                  onClick={cancelDraw}
                  className="px-2 py-0.5 text-[9px] uppercase tracking-widest border border-white/10 text-on-surface-variant hover:text-red-emergency hover:border-red-emergency/40 transition-colors focus:outline-none"
                >
                  Cancel
                </button>
              </>
            )}
          </div>

          {/* Annotation list panel */}
          {showList && annotationDrawMode === null && (
            <div className="bg-onyx-black/95 border border-amber-gold-muted border-t-0 w-[280px] shadow-2xl">
              <div className="px-2 py-1.5 border-b border-white/5 flex items-center justify-between">
                <span className="label-caps text-[9px] text-amber-gold">Annotations</span>
                <span className="text-[9px] text-on-surface-variant">{annotations.length} active</span>
              </div>
              {annotations.length === 0 ? (
                <div className="px-3 py-4 text-[10px] text-on-surface-variant text-center">
                  No annotations yet
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto">
                  {annotations.map((ann) => (
                    <div
                      key={ann.id}
                      className="flex items-center gap-2 px-2 py-1.5 border-b border-white/5 hover:bg-white/5 group"
                    >
                      {/* Color swatch */}
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: ann.color }}
                      />
                      {/* Type icon */}
                      <span className="ms text-[12px] text-on-surface-variant flex-shrink-0">
                        {TYPE_ICON[ann.annotation_type]}
                      </span>
                      {/* Label / fallback */}
                      <span className="text-[10px] text-on-surface truncate flex-1 min-w-0">
                        {ann.label || <span className="text-on-surface-variant italic">unlabeled</span>}
                      </span>
                      {/* Badges */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {ann.tak_uid && (
                          <span className="text-[8px] text-teal-400 border border-teal-400/30 px-0.5 leading-tight">
                            TAK
                          </span>
                        )}
                        <span className={`text-[8px] tabular-nums ${
                          !ann.expires_at ? 'text-on-surface-variant'
                          : new Date(ann.expires_at).getTime() - Date.now() < 3_600_000
                            ? 'text-red-emergency' : 'text-on-surface-variant'
                        }`}>
                          {formatExpiry(ann.expires_at)}
                        </span>
                      </div>
                      {/* Actions — shown on hover */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => openEdit(ann)}
                          className="w-5 h-5 flex items-center justify-center text-on-surface-variant hover:text-amber-gold focus:outline-none"
                          title="Edit"
                        >
                          <span className="ms text-[12px]">edit</span>
                        </button>
                        <button
                          onClick={() => handleDelete(ann.id)}
                          className="w-5 h-5 flex items-center justify-center text-on-surface-variant hover:text-red-emergency focus:outline-none"
                          title="Delete"
                        >
                          <span className="ms text-[12px]">delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Save / Edit form modal */}
      {showForm && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/30 pointer-events-auto">
          <div className="bg-onyx-black border border-white/10 p-4 w-72 shadow-2xl">
            <h3 className="label-caps text-amber-gold mb-3">
              {editingAnnot ? 'Edit Annotation' : 'Save Annotation'}
            </h3>

            {editingAnnot && (
              <div className="flex items-center gap-1.5 mb-3 text-[9px] text-on-surface-variant">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: editingAnnot.color }} />
                <span className="uppercase">{editingAnnot.annotation_type}</span>
                <span className="mx-1 opacity-30">·</span>
                <span>Currently {formatExpiry(editingAnnot.expires_at).toLowerCase()}</span>
                {editingAnnot.tak_uid && (
                  <span className="ml-auto text-teal-400 border border-teal-400/30 px-0.5">TAK</span>
                )}
              </div>
            )}

            <input
              type="text"
              placeholder="Label (optional)"
              value={saveLabel}
              onChange={(e) => setSaveLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveAnnotation() }}
              className="w-full bg-onyx-deep border border-white/10 text-on-surface placeholder-on-surface-variant text-[11px] px-3 py-1.5 mb-3 focus:outline-none focus:border-amber-gold/60 transition-colors"
              autoFocus
            />

            <div className="mb-3">
              <label className="label-caps text-[8px] block mb-1.5">Color</label>
              <div className="flex gap-1.5">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setSaveColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-all focus:outline-none ${
                      saveColor === c ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="label-caps text-[8px] block mb-1.5">
                {editingAnnot ? 'Set New Expiry' : 'Expires'}
              </label>
              <div className="flex gap-1">
                {(['4h', '12h', '24h', 'permanent'] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setSaveExpiry(opt)}
                    className={`flex-1 py-0.5 text-[9px] uppercase tracking-widest border transition-colors focus:outline-none ${
                      saveExpiry === opt
                        ? 'border-amber-gold/60 text-amber-gold bg-amber-gold/10'
                        : 'border-white/10 text-on-surface-variant hover:border-amber-gold/30'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={saveAnnotation}
                disabled={saving}
                className="flex-1 py-1.5 text-[9px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 transition-colors focus:outline-none disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingAnnot ? 'Update' : 'Save'}
              </button>
              <button
                onClick={cancelForm}
                className="flex-1 py-1.5 text-[9px] uppercase tracking-widest border border-white/10 text-on-surface-variant hover:text-on-surface transition-colors focus:outline-none"
              >
                {editingAnnot ? 'Cancel' : 'Discard'}
              </button>
              {editingAnnot && (
                <button
                  onClick={() => { handleDelete(editingAnnot.id); cancelForm() }}
                  className="py-1.5 px-2 text-[9px] uppercase tracking-widest border border-red-emergency/30 text-red-emergency hover:bg-red-emergency/10 transition-colors focus:outline-none"
                  title="Delete annotation"
                >
                  <span className="ms text-[12px]">delete</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Click popup — richer info card */}
      {popupAnnot && !showForm && (
        <div
          className="absolute z-20 pointer-events-auto"
          style={{ left: popupPos.x + 10, top: popupPos.y - 10 }}
        >
          <div className="bg-onyx-black border border-white/15 shadow-xl w-48">
            {/* Header row: color + type + label */}
            <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1.5 border-b border-white/5">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: popupAnnot.color }} />
              <span className="ms text-[12px] text-on-surface-variant flex-shrink-0">{TYPE_ICON[popupAnnot.annotation_type]}</span>
              <span className="text-[10px] text-on-surface font-semibold truncate flex-1 min-w-0">
                {popupAnnot.label || <span className="text-on-surface-variant italic font-normal">Unlabeled</span>}
              </span>
            </div>

            {/* Meta row */}
            <div className="px-2.5 py-1.5 flex items-center gap-2 border-b border-white/5">
              <span className={`text-[9px] ${
                !popupAnnot.expires_at ? 'text-on-surface-variant'
                : new Date(popupAnnot.expires_at).getTime() - Date.now() < 3_600_000
                  ? 'text-red-emergency' : 'text-on-surface-variant'
              }`}>
                {formatExpiry(popupAnnot.expires_at) === 'Permanent'
                  ? 'Permanent'
                  : `Expires ${formatExpiry(popupAnnot.expires_at)}`}
              </span>
              {popupAnnot.tak_uid && (
                <span className="ml-auto text-[8px] text-teal-400 border border-teal-400/30 px-0.5 leading-tight">
                  TAK
                </span>
              )}
            </div>

            {/* Action row */}
            <div className="flex items-center px-2 py-1.5 gap-1">
              <button
                onClick={() => openEdit(popupAnnot)}
                className="flex-1 flex items-center justify-center gap-1 py-0.5 text-[9px] text-on-surface-variant hover:text-amber-gold uppercase tracking-widest focus:outline-none"
              >
                <span className="ms text-[11px]">edit</span>
                Edit
              </button>
              <div className="w-px h-3 bg-white/10" />
              <button
                onClick={() => handleDelete(popupAnnot.id)}
                className="flex-1 flex items-center justify-center gap-1 py-0.5 text-[9px] text-on-surface-variant hover:text-red-emergency uppercase tracking-widest focus:outline-none"
              >
                <span className="ms text-[11px]">delete</span>
                Delete
              </button>
              <div className="w-px h-3 bg-white/10" />
              <button
                onClick={() => setPopupAnnotId(null)}
                className="px-1.5 py-0.5 text-[9px] text-on-surface-variant hover:text-on-surface uppercase tracking-widest focus:outline-none"
              >
                <span className="ms text-[11px]">close</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
