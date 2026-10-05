import { useState } from 'react'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

type Position = [number, number]
type BoundaryGeometry =
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }

export interface BoundaryCandidate {
  id: string
  name: string
  kind: 'city' | 'county' | 'zip'
  source: string
  area_km2: number
  geojson: BoundaryGeometry
}

const KIND_LABELS: Record<BoundaryCandidate['kind'], string> = {
  city: 'City',
  county: 'County',
  zip: 'ZIP',
}

/** Outer rings of a (Multi)Polygon. */
function outerRings(g: BoundaryGeometry): Position[][] {
  return g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0])
}

/** SVG path for a thumbnail of the boundary, fitted to a size×size box. */
function thumbnailPath(g: BoundaryGeometry, size: number): string {
  const rings = outerRings(g)
  const pts = rings.flat()
  if (pts.length === 0) return ''
  const lons = pts.map((p) => p[0])
  const lats = pts.map((p) => p[1])
  const [minLon, maxLon, minLat, maxLat] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]
  // Scale longitude by cos(latitude) so shapes are not stretched east-west.
  const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))
  const w = (maxLon - minLon) * kx || 1e-9
  const h = maxLat - minLat || 1e-9
  const scale = (size - 4) / Math.max(w, h)
  const ox = (size - w * scale) / 2
  const oy = (size - h * scale) / 2
  return rings
    .map((ring) => ring
      .map(([lon, lat], i) => `${i ? 'L' : 'M'}${(ox + (lon - minLon) * kx * scale).toFixed(1)},${(oy + (maxLat - lat) * scale).toFixed(1)}`)
      .join('') + 'Z')
    .join('')
}

export function BoundarySearch({ onUse }: { onUse: (candidate: BoundaryCandidate) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BoundaryCandidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    const q = query.trim()
    if (q.length < 2) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/geofences/boundaries?q=${encodeURIComponent(q)}`, { headers: authHeaders() })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`)
      }
      setResults(await res.json())
    } catch (e) {
      setResults(null)
      setError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-white/10 bg-onyx-deep/40 p-3 stack-y-2">
      <span className="label-caps block">Find Boundary</span>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); search() }}
      >
        <input
          type="text"
          placeholder="City, county or ZIP code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="City, county or ZIP code"
          className="flex-1 min-w-0 bg-onyx-deep border border-white/10 text-on-surface placeholder-on-surface-variant text-[11px] px-3 py-1.5 focus:outline-hidden focus:border-amber-gold/60 transition-colors"
        />
        <button
          type="submit"
          disabled={busy || query.trim().length < 2}
          className="flex items-center gap-1 px-3 py-1.5 border border-amber-gold/60 text-amber-gold text-[11px] font-bold uppercase tracking-widest hover:bg-amber-gold/10 transition-colors focus:outline-hidden disabled:opacity-50"
        >
          <span className={`ms text-[14px] leading-none ${busy ? 'animate-pulse' : ''}`} aria-hidden="true">travel_explore</span>
          {busy ? 'Searching' : 'Search'}
        </button>
      </form>

      {error && <p className="text-[11px] text-red-emergency">{error}</p>}

      {results && results.length === 0 && (
        <p className="text-[11px] text-on-surface-variant italic">No boundary found.</p>
      )}

      {results && results.length > 0 && (
        <ul className="stack-y-1">
          {results.map((c) => (
            <li key={c.id} className="flex items-center gap-3 p-2 border border-white/5 hover:bg-surface-container transition-colors">
              <svg width={40} height={40} viewBox="0 0 40 40" className="shrink-0 bg-onyx-black border border-white/5" aria-hidden="true">
                <path d={thumbnailPath(c.geojson, 40)} className="fill-amber-gold/15 stroke-amber-gold" strokeWidth={1} />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-on-surface font-bold truncate">{c.name}</div>
                <div className="text-[11px] text-on-surface-variant uppercase tracking-widest">
                  {KIND_LABELS[c.kind]} · <span className="font-mono">{c.area_km2.toLocaleString()} km²</span>
                </div>
              </div>
              <button
                onClick={() => onUse(c)}
                className="px-2 py-1 border border-amber-gold/60 text-amber-gold text-[11px] font-bold uppercase tracking-widest hover:bg-amber-gold/10 transition-colors focus:outline-hidden"
              >
                Use
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
