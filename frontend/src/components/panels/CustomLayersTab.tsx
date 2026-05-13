import { useState, useCallback, useEffect, useRef } from 'react'
import { useCivicStore, CustomLayerItem } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

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

export function CustomLayersTab() {
  const { customLayers, setCustomLayers } = useCivicStore()

  const fileInputRef               = useRef<HTMLInputElement>(null)
  const [layerImportName, setLayerImportName] = useState('')
  const [layerImportGeoJson, setLayerImportGeoJson] = useState<object | null>(null)
  const [layerImportError, setLayerImportError] = useState<string | null>(null)
  const [layerSaving, setLayerSaving] = useState(false)
  const [dragOver, setDragOver]    = useState(false)

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
    if (file.size > 5 * 1024 * 1024) {
      setLayerImportError('File too large — maximum 5 MB.')
      return
    }
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

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${dragOver ? 'border-amber-gold bg-amber-gold/10 text-amber-gold' : 'border-white/20 hover:border-white/40 text-on-surface-variant'}`}
      >
        <span className="ms text-[32px] leading-none" aria-hidden="true">upload_file</span>
        <span className="text-[11px] font-bold uppercase tracking-widest">Drop KML, GeoJSON, or JSON</span>
        <span className="text-[11px] opacity-60">or click to browse</span>
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
          <span className="label-caps text-[11px] text-amber-gold block">Name this layer</span>
          <input
            type="text"
            placeholder="Layer name *"
            value={layerImportName}
            onChange={(e) => setLayerImportName(e.target.value)}
            className="w-full bg-onyx-deep border border-white/10 text-on-surface placeholder-on-surface-variant text-[11px] px-3 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
          />
          {layerImportError && <p className="text-[11px] text-red-emergency">{layerImportError}</p>}
          <div className="flex gap-2">
            <button
              onClick={saveCustomLayer}
              disabled={layerSaving || !layerImportName.trim()}
              className="flex-1 py-1.5 bg-amber-gold/10 border border-amber-gold/60 text-amber-gold text-[11px] font-bold uppercase tracking-widest hover:bg-amber-gold/20 transition-colors focus:outline-none disabled:opacity-50"
            >
              {layerSaving ? 'Saving…' : 'Add to Map'}
            </button>
            <button
              onClick={() => { setLayerImportGeoJson(null); setLayerImportName(''); setLayerImportError(null) }}
              className="px-3 py-1.5 border border-white/10 text-on-surface-variant text-[11px] uppercase tracking-widest hover:border-white/20 transition-colors focus:outline-none"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {layerImportError && !layerImportGeoJson && (
        <p className="text-[11px] text-red-emergency">{layerImportError}</p>
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
                className={`ms text-[18px] leading-none transition-colors focus:outline-none shrink-0 ${layer.visible ? 'text-amber-gold' : 'text-on-surface-variant/30'}`}
                style={{ fontVariationSettings: layer.visible ? "'FILL' 1" : "'FILL' 0" }}
              >
                {layer.visible ? 'visibility' : 'visibility_off'}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-on-surface font-bold truncate">{layer.name}</div>
                <div className="text-[11px] text-on-surface-variant uppercase tracking-widest">
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
  )
}
