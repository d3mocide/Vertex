import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import type { AnnotationItem } from '../../storeTypes'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

const COLOR_PRESETS = ['#FF4444', '#FF8800', '#FFB800', '#44DD88', '#00BBFF', '#AA44FF', '#FF44AA']

const SRC_ANNOTATIONS = 'annotations-source'
const SRC_DRAW        = 'annotation-draw-source'

function expiryToIso(expiry: string): string | null {
  const hours: Record<string, number> = { '4h': 4, '12h': 12, '24h': 24 }
  const h = hours[expiry]
  return h != null ? new Date(Date.now() + h * 3_600_000).toISOString() : null
}

function toFeatureCollection(items: AnnotationItem[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items.map((a) => ({
      type: 'Feature',
      properties: { id: a.id, label: a.label ?? '', color: a.color, annotation_type: a.annotation_type },
      geometry: a.geojson as GeoJSON.Geometry,
    })),
  }
}

interface Props { map: maplibregl.Map }

export function AnnotationOverlay({ map }: Props) {
  const annotations         = useCivicStore((s) => s.annotations)
  const setAnnotations      = useCivicStore((s) => s.setAnnotations)
  const addAnnotation       = useCivicStore((s) => s.addAnnotation)
  const removeAnnotation    = useCivicStore((s) => s.removeAnnotation)
  const annotationDrawMode  = useCivicStore((s) => s.annotationDrawMode)
  const setAnnotationDrawMode = useCivicStore((s) => s.setAnnotationDrawMode)
  const annotationsVisible  = useCivicStore((s) => s.annotationsVisible)
  const setAnnotationsVisible = useCivicStore((s) => s.setAnnotationsVisible)

  // Draw refs — used inside map event handlers to avoid stale closures
  const drawModeRef   = useRef<'marker' | 'line' | 'polygon' | null>(null)
  const drawPointsRef = useRef<[number, number][]>([])
  const cursorPtRef   = useRef<[number, number] | null>(null)

  // Draw UI state
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([])

  // Save form state
  const [pendingGeom, setPendingGeom] = useState<GeoJSON.Geometry | null>(null)
  const [saveLabel,   setSaveLabel]   = useState('')
  const [saveColor,   setSaveColor]   = useState('#FFB800')
  const [saveExpiry,  setSaveExpiry]  = useState('permanent')
  const [saving,      setSaving]      = useState(false)

  // Annotation click popup
  const [selectedAnnot, setSelectedAnnot] = useState<{
    id: number; label: string | null; x: number; y: number
  } | null>(null)

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

  // Keep drawModeRef in sync with store
  useEffect(() => { drawModeRef.current = annotationDrawMode }, [annotationDrawMode])

  // Cursor style while drawing
  useEffect(() => {
    map.getCanvas().style.cursor = annotationDrawMode ? 'crosshair' : ''
  }, [map, annotationDrawMode])

  // Update the draw preview GeoJSON source
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
      features.push({
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: preview },
      })
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

  // Finalize a line or polygon draw
  const finalizeDraw = useCallback((mode: 'line' | 'polygon', pts: [number, number][]) => {
    const geom: GeoJSON.Geometry = mode === 'line'
      ? { type: 'LineString', coordinates: pts }
      : { type: 'Polygon',    coordinates: [[...pts, pts[0]]] }
    setPendingGeom(geom)
    setAnnotationDrawMode(null)
    drawPointsRef.current = []
    cursorPtRef.current   = null
    setDrawPoints([])
    clearDrawSource()
    map.getCanvas().style.cursor = ''
  }, [map, setAnnotationDrawMode, clearDrawSource])

  // Setup MapLibre sources and layers once
  useEffect(() => {
    const setup = () => {
      if (map.getSource(SRC_ANNOTATIONS)) return

      map.addSource(SRC_ANNOTATIONS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource(SRC_DRAW,        { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

      // Saved annotation layers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expr = (e: unknown) => e as any

      map.addLayer({
        id: 'annotation-polygon-fill', type: 'fill', source: SRC_ANNOTATIONS,
        filter: expr(['==', ['get', 'annotation_type'], 'polygon']),
        paint: { 'fill-color': expr(['get', 'color']), 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: 'annotation-line', type: 'line', source: SRC_ANNOTATIONS,
        filter: expr(['any',
          ['==', ['get', 'annotation_type'], 'line'],
          ['==', ['get', 'annotation_type'], 'polygon'],
        ]),
        paint: { 'line-color': expr(['get', 'color']), 'line-width': 2 },
      })
      map.addLayer({
        id: 'annotation-marker', type: 'circle', source: SRC_ANNOTATIONS,
        filter: expr(['==', ['get', 'annotation_type'], 'marker']),
        paint: {
          'circle-color': expr(['get', 'color']),
          'circle-radius': 7,
          'circle-stroke-color': '#000000',
          'circle-stroke-width': 1.5,
        },
      })
      map.addLayer({
        id: 'annotation-label', type: 'symbol', source: SRC_ANNOTATIONS,
        layout: {
          'text-field': expr(['get', 'label']),
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.7],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': expr(['get', 'color']),
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
        },
      })

      // Draw preview layers
      map.addLayer({
        id: 'annotation-draw-fill', type: 'fill', source: SRC_DRAW,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#FFB800', 'fill-opacity': 0.1 },
      })
      map.addLayer({
        id: 'annotation-draw-line', type: 'line', source: SRC_DRAW,
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': '#FFB800', 'line-width': 2, 'line-dasharray': [4, 2] },
      })
      map.addLayer({
        id: 'annotation-draw-points', type: 'circle', source: SRC_DRAW,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-color': '#FFB800', 'circle-radius': 4,
          'circle-stroke-color': '#000000', 'circle-stroke-width': 1,
        },
      })
    }

    if (map.isStyleLoaded()) setup()
    else map.once('load', setup)

    return () => {
      for (const id of [
        'annotation-draw-points', 'annotation-draw-line', 'annotation-draw-fill',
        'annotation-label', 'annotation-marker', 'annotation-line', 'annotation-polygon-fill',
      ]) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
      for (const id of [SRC_ANNOTATIONS, SRC_DRAW]) {
        if (map.getSource(id)) map.removeSource(id)
      }
    }
  }, [map])

  // Sync annotations → MapLibre source
  useEffect(() => {
    const src = map.getSource(SRC_ANNOTATIONS) as maplibregl.GeoJSONSource | undefined
    src?.setData(toFeatureCollection(annotations))
  }, [map, annotations])

  // Sync visibility
  useEffect(() => {
    const vis = annotationsVisible ? 'visible' : 'none'
    for (const id of ['annotation-polygon-fill', 'annotation-line', 'annotation-marker', 'annotation-label']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
    }
  }, [map, annotationsVisible])

  // Draw interaction — click, dblclick, mousemove
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
        clearDrawSource()
        map.getCanvas().style.cursor = ''
        return
      }

      const newPts: [number, number][] = [...drawPointsRef.current, pt]
      drawPointsRef.current = newPts
      setDrawPoints([...newPts])
      updateDrawSource()
    }

    const handleDblClick = (e: maplibregl.MapMouseEvent) => {
      const mode = drawModeRef.current
      if (!mode || mode === 'marker') return
      e.preventDefault()
      // Remove the phantom point added by the first click of the double-click
      const pts = drawPointsRef.current.slice(0, -1)
      if (mode === 'line' && pts.length >= 2) finalizeDraw(mode, pts)
      else if (mode === 'polygon' && pts.length >= 3) finalizeDraw(mode, pts)
    }

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (!drawModeRef.current || drawModeRef.current === 'marker') return
      cursorPtRef.current = [e.lngLat.lng, e.lngLat.lat]
      updateDrawSource()
    }

    map.on('click',     handleClick)
    map.on('dblclick',  handleDblClick)
    map.on('mousemove', handleMouseMove)
    return () => {
      map.off('click',     handleClick)
      map.off('dblclick',  handleDblClick)
      map.off('mousemove', handleMouseMove)
    }
  }, [map, updateDrawSource, finalizeDraw, setAnnotationDrawMode, clearDrawSource])

  // Click on existing annotations
  useEffect(() => {
    const handleAnnotClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (drawModeRef.current) return
      const feature = e.features?.[0]
      if (!feature) return
      const { id, label } = feature.properties as { id: number; label: string }
      setSelectedAnnot({ id, label: label || null, x: e.point.x, y: e.point.y })
    }
    const enterCursor = () => { if (!drawModeRef.current) map.getCanvas().style.cursor = 'pointer' }
    const leaveCursor = () => { if (!drawModeRef.current) map.getCanvas().style.cursor = '' }

    const layers = ['annotation-polygon-fill', 'annotation-line', 'annotation-marker']
    for (const id of layers) {
      map.on('click',       id, handleAnnotClick)
      map.on('mouseenter',  id, enterCursor)
      map.on('mouseleave',  id, leaveCursor)
    }
    return () => {
      for (const id of layers) {
        map.off('click',       id, handleAnnotClick)
        map.off('mouseenter',  id, enterCursor)
        map.off('mouseleave',  id, leaveCursor)
      }
    }
  }, [map])

  const cancelDraw = useCallback(() => {
    setAnnotationDrawMode(null)
    drawPointsRef.current = []
    cursorPtRef.current   = null
    setDrawPoints([])
    clearDrawSource()
    map.getCanvas().style.cursor = ''
  }, [map, setAnnotationDrawMode, clearDrawSource])

  const finishDraw = () => {
    const mode = annotationDrawMode
    const pts  = drawPointsRef.current
    if (!mode || mode === 'marker') return
    if (mode === 'line'    && pts.length >= 2) finalizeDraw(mode, pts)
    if (mode === 'polygon' && pts.length >= 3) finalizeDraw(mode, pts)
  }

  const saveAnnotation = async () => {
    if (!pendingGeom) return
    setSaving(true)
    try {
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
        setPendingGeom(null)
        setSaveLabel('')
        setSaveColor('#FFB800')
        setSaveExpiry('permanent')
      }
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
  }

  const handleDeleteAnnot = async (id: number) => {
    try {
      await fetch(`${API_BASE}/annotations/${id}`, { method: 'DELETE', headers: authHeaders() })
      removeAnnotation(id)
      setSelectedAnnot(null)
    } catch { /* non-fatal */ }
  }

  const isDoneEnabled =
    annotationDrawMode === 'line'    ? drawPoints.length >= 2 :
    annotationDrawMode === 'polygon' ? drawPoints.length >= 3 : false

  const btnBase = 'flex items-center justify-center w-8 h-8 border transition-colors focus:outline-none'
  const btnOn   = `${btnBase} border-amber-gold/60 text-amber-gold bg-amber-gold/10`
  const btnOff  = `${btnBase} border-white/10 text-on-surface-variant hover:border-amber-gold/40 hover:text-amber-gold`

  return (
    <>
      {/* Draw toolbar — centered at map bottom */}
      {!pendingGeom && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-onyx-black/90 border border-white/10 px-2 py-1.5 z-10 pointer-events-auto select-none">
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
      )}

      {/* Save form */}
      {pendingGeom && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/30 pointer-events-auto">
          <div className="bg-onyx-black border border-white/10 p-4 w-72 shadow-2xl">
            <h3 className="label-caps text-amber-gold mb-3">Save Annotation</h3>
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
              <label className="label-caps text-[8px] block mb-1.5">Expires</label>
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
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setPendingGeom(null); setSaveLabel(''); setSaveColor('#FFB800'); setSaveExpiry('permanent') }}
                className="flex-1 py-1.5 text-[9px] uppercase tracking-widest border border-white/10 text-on-surface-variant hover:text-on-surface transition-colors focus:outline-none"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Annotation info popup */}
      {selectedAnnot && (
        <div
          className="absolute z-20 pointer-events-auto"
          style={{ left: selectedAnnot.x + 8, top: selectedAnnot.y - 8 }}
        >
          <div className="bg-onyx-black border border-white/10 p-2 shadow-lg min-w-[120px]">
            {selectedAnnot.label && (
              <div className="text-[10px] text-on-surface font-bold mb-1.5 truncate max-w-[180px]">
                {selectedAnnot.label}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDeleteAnnot(selectedAnnot.id)}
                className="text-[9px] text-red-emergency hover:text-red-emergency/80 uppercase tracking-widest focus:outline-none"
              >
                Delete
              </button>
              <button
                onClick={() => setSelectedAnnot(null)}
                className="text-[9px] text-on-surface-variant hover:text-on-surface uppercase tracking-widest focus:outline-none"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
