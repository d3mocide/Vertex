import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../../store'
import { RADAR_LAYER, MAP_STYLE, DEFAULT_CENTER } from '../../../config'
import { RadarLayer } from '../../layers/RadarLayer'

function RadarMiniMapCanvas({ isFullHeight }: { isFullHeight?: boolean }) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current) return

    const m = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: 6.5,
      interactive: false,
      attributionControl: false,
    })

    m.on('load', () => {
      const canvas = m.getCanvas()
      canvas.style.filter = 'brightness(0.85) contrast(1.1)'
      setMap(m)
    })

    return () => { m.remove() }
  }, [])

  return (
    <div
      className={`relative w-full ${isFullHeight ? 'flex-1 min-h-0' : 'h-[420px]'} bg-onyx-deep/60 rounded-sm overflow-hidden mb-4 border border-white/5`}
      style={{
        maskImage: 'radial-gradient(ellipse 88% 88% at 50% 50%, black 45%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 88% 88% at 50% 50%, black 45%, transparent 100%)',
      }}
    >
      <div ref={mapContainerRef} className="absolute inset-0" />
      {map && <RadarLayer map={map} />}

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-t from-onyx-black/40 to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center opacity-20">
          <div className="w-4 h-px bg-amber-gold" />
          <div className="h-4 w-px bg-amber-gold" />
        </div>
        <div
          className="absolute inset-0 animate-spin-slow opacity-20"
          style={{ background: 'conic-gradient(from 0deg, rgba(255, 184, 0, 0.15) 0deg, transparent 90deg)' }}
        />
      </div>
    </div>
  )
}

export function RadarControls({ isFullHeight }: { isFullHeight?: boolean }) {
  const radarOpacity  = useCivicStore((s) => s.radarOpacity)
  const setRadarOpacity = useCivicStore((s) => s.setRadarOpacity)

  const handleOpacity = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setRadarOpacity(Number(e.target.value)),
    [setRadarOpacity],
  )

  return (
    <div className={`hud-panel p-4 bg-onyx-deep/40 flex flex-col ${isFullHeight ? 'h-full' : ''}`}>
      <RadarMiniMapCanvas isFullHeight={isFullHeight} />

      <div className="transition-all duration-300">
        <div className="flex items-center justify-between mb-2">
          <span className="label-caps text-[9px] text-on-surface-variant">SCAN OPACITY</span>
          <span className="font-mono text-[10px] text-amber-gold font-bold">
            {Math.round(radarOpacity * 100)}%
          </span>
        </div>
        <div className="relative flex items-center h-4">
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={radarOpacity}
            onChange={handleOpacity}
            className="w-full accent-amber-gold bg-white/5 h-1 rounded-full appearance-none cursor-pointer"
            aria-label="Radar opacity"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between font-mono text-[8px] text-on-surface-variant/60 uppercase tracking-widest">
        <span>{RADAR_LAYER.replace(/-0$/, '')} · IEM NEXRAD</span>
        <span>5 MIN REFRESH</span>
      </div>
    </div>
  )
}
