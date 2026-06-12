import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../../store'
import { RADAR_LAYER, MAP_STYLE, DEFAULT_CENTER } from '../../../config'
import { RadarLayer } from '../../layers/RadarLayer'
import { RadarReflectivityLayer } from '../../layers/RadarReflectivityLayer'
import { NWSAlertsLayer } from '../../layers/NWSAlertsLayer'
import { LightningDensityLayer } from '../../layers/LightningDensityLayer'
import { GOESLayer } from '../../layers/GOESLayer'
import { ensureKnownStyleImages, KNOWN_STYLE_IMAGE_FALLBACKS } from '../../Map'

interface MiniMapVisibility {
  iemRadar: boolean
  noaaRadar: boolean
  nwsAlerts: boolean
  lightning: boolean
  satellite: boolean
}

function RadarMiniMapCanvas({ 
  isFullHeight, 
  visibility 
}: { 
  isFullHeight?: boolean
  visibility: MiniMapVisibility
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const radarOpacity = useCivicStore((s) => s.radarOpacity)

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

    const warnedMissing = new Set<string>()
    let ensureKnownImagesInFlight = false

    const ensureKnownImages = async () => {
      if (ensureKnownImagesInFlight) return
      ensureKnownImagesInFlight = true
      try {
        await ensureKnownStyleImages(m)
      } finally {
        ensureKnownImagesInFlight = false
      }
    }

    m.on('styledata', () => {
      if (m.isStyleLoaded()) void ensureKnownImages()
    })

    m.on('styleimagemissing', (e) => {
      const id = e.id
      if (m.hasImage(id)) return

      const makeFallback = KNOWN_STYLE_IMAGE_FALLBACKS[id]
      if (makeFallback) {
        m.addImage(id, makeFallback())
        return
      }

      if (!warnedMissing.has(id)) {
        warnedMissing.add(id)
        console.warn(`Map style image missing: ${id}. Using transparent fallback.`)
      }
      const data = new Uint8Array(4)
      m.addImage(id, { width: 1, height: 1, data })
    })

    m.on('load', () => {
      const canvas = m.getCanvas()
      canvas.style.filter = 'brightness(0.85) contrast(1.1)'
      void ensureKnownImages()
      setMap(m)
    })

    return () => { m.remove() }
  }, [])

  return (
    <div
      className={`relative w-full ${isFullHeight ? 'flex-1 min-h-0' : 'h-[420px]'} bg-onyx-deep/60 rounded-sm overflow-hidden mb-4 border border-white/5 shadow-inner`}
    >
      <div ref={mapContainerRef} className="absolute inset-0" />
      
      {map && (
        <>
          <RadarLayer map={map} forceVisible={visibility.iemRadar} />
          <RadarReflectivityLayer map={map} visible={visibility.noaaRadar} opacity={radarOpacity} />
          <NWSAlertsLayer map={map} visible={visibility.nwsAlerts} />
          <LightningDensityLayer map={map} visible={visibility.lightning} />
          <GOESLayer map={map} visible={visibility.satellite} />
        </>
      )}

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-t from-onyx-black/60 to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center opacity-20">
          <div className="w-4 h-px bg-amber-gold" />
          <div className="h-4 w-px bg-amber-gold" />
        </div>
        <div
          className="absolute inset-0 animate-spin-slow opacity-10"
          style={{ background: 'conic-gradient(from 0deg, rgba(255, 184, 0, 0.15) 0deg, transparent 90deg)' }}
        />
      </div>
    </div>
  )
}

export function RadarControls({ isFullHeight }: { isFullHeight?: boolean }) {
  const radarOpacity  = useCivicStore((s) => s.radarOpacity)
  const setRadarOpacity = useCivicStore((s) => s.setRadarOpacity)

  // Local state for mini-map visibility independent of global map
  const [visibility, setVisibility] = useState<MiniMapVisibility>({
    iemRadar: true,
    noaaRadar: false,
    nwsAlerts: false,
    lightning: false,
    satellite: false,
  })

  const toggle = (key: keyof MiniMapVisibility) => {
    setVisibility(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleOpacity = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setRadarOpacity(Number(e.target.value)),
    [setRadarOpacity],
  )

  return (
    <div className={`hud-panel p-4 bg-onyx-deep/40 flex flex-col ${isFullHeight ? 'h-full' : ''}`}>
      {/* Tactical Overlays Local Toggles */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar py-1">
        <MiniToggle
          active={visibility.iemRadar}
          onClick={() => toggle('iemRadar')}
          icon="radar"
          label="IEM"
        />
        <MiniToggle
          active={visibility.noaaRadar}
          onClick={() => toggle('noaaRadar')}
          icon="radar"
          label="NOAA"
        />
        <MiniToggle
          active={visibility.nwsAlerts}
          onClick={() => toggle('nwsAlerts')}
          icon="notification_important"
          label="Alerts"
        />
        <MiniToggle
          active={visibility.lightning}
          onClick={() => toggle('lightning')}
          icon="electric_bolt"
          label="Bolts"
        />
        <MiniToggle
          active={visibility.satellite}
          onClick={() => toggle('satellite')}
          icon="satellite_alt"
          label="Sat"
        />
      </div>

      <RadarMiniMapCanvas isFullHeight={isFullHeight} visibility={visibility} />

      <div className="transition-all duration-300">
        <div className="flex items-center justify-between mb-2">
          <span className="label-caps text-[9px] lg:text-[11px] text-on-surface-variant uppercase tracking-widest">SCAN OPACITY</span>
          <span className="font-mono text-[10px] lg:text-[11px] text-amber-gold font-bold">
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

      <div className="mt-4 flex items-center justify-between font-mono text-[8px] lg:text-[11px] text-on-surface-variant/60 uppercase tracking-widest">
        <span>{RADAR_LAYER.replace(/-0$/, '')} · MULTI-SOURCE</span>
        <span>5 MIN REFRESH</span>
      </div>
    </div>
  )
}

function MiniToggle({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-2 py-1 rounded-sm border transition-all duration-300
        ${active
          ? 'bg-amber-gold/20 border-amber-gold/40 text-amber-gold shadow-[0_0_10px_rgba(255,184,0,0.1)]'
          : 'bg-white/5 border-white/5 text-on-surface-variant/60 hover:bg-white/10 hover:text-on-surface'}
      `}
    >
      <span className="ms text-[14px]" style={{ fontVariationSettings: `'FILL' ${active ? 1 : 0}` }}>{icon}</span>
      <span className="text-[9px] lg:text-[11px] font-black uppercase tracking-tight whitespace-nowrap">{label}</span>
    </button>
  )
}
