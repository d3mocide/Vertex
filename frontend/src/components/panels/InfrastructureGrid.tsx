import { useState, useEffect } from 'react'
import { useCivicStore, TrafficCamera } from '../../store'

function CctvThumbnail({
  cam, ldi, isFavorite, onToggleFavorite,
}: {
  cam: TrafficCamera
  ldi: boolean
  isFavorite: boolean
  onToggleFavorite: (e: React.MouseEvent) => void
}) {
  const [imgError, setImgError] = useState(false)
  const src = ldi && cam.ldi_url ? cam.ldi_url : cam.url

  return (
    <div
      className="cctv-thumb"
      role="img"
      aria-label={`CCTV camera: ${cam.name}`}
      tabIndex={0}
    >
      {imgError || !src ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-container gap-2">
          <span
            className="ms text-[32px] text-on-surface-variant"
            aria-hidden="true"
            style={{ fontVariationSettings: "'FILL' 0" }}
          >
            videocam_off
          </span>
          <span className="font-mono text-[9px] text-on-surface-variant uppercase">
            No Signal
          </span>
        </div>
      ) : (
        <img
          src={src}
          alt={cam.name}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      )}
      {/* Favorite bookmark */}
      <button
        onClick={onToggleFavorite}
        className="absolute top-1 left-1 p-0.5 text-amber-gold hover:scale-110 transition-transform"
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        title={isFavorite ? 'Remove from favorites' : 'Bookmark feed'}
      >
        <span
          className="ms text-[16px] leading-none"
          aria-hidden="true"
          style={{ fontVariationSettings: `'FILL' ${isFavorite ? 1 : 0}` }}
        >
          bookmark
        </span>
      </button>
      {/* Camera label overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-onyx-black/80 px-2 py-1 flex items-center justify-between">
        <span className="font-mono text-[9px] text-amber-gold uppercase truncate mr-1">
          {cam.name}
        </span>
        {cam.dist_km && (
          <span className="font-mono text-[8px] text-on-surface-variant shrink-0">
            {cam.dist_km}km
          </span>
        )}
      </div>
      {ldi && cam.ldi_url && (
        <div className="absolute top-1 right-1 bg-amber-gold-muted px-1 py-0.5">
          <span className="font-mono text-[8px] text-amber-gold uppercase">LDI</span>
        </div>
      )}
    </div>
  )
}

function UtilityStatusRow({
  label,
  value,
  status,
}: {
  label: string
  value: string
  status: 'ok' | 'warn' | 'down'
}) {
  const dot = {
    ok:   'bg-green-ais',
    warn: 'bg-amber-gold animate-pulse',
    down: 'bg-red-emergency animate-pulse',
  }[status]

  return (
    <div className="flex items-center justify-between py-2 border-b border-amber-gold-muted/20">
      <span className="text-[11px] text-on-surface-variant">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-on-surface">{value}</span>
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${dot}`}
          aria-label={`Status: ${status}`}
        />
      </div>
    </div>
  )
}

// Placeholder camera data when backend returns empty
const PLACEHOLDER_CAMERAS: TrafficCamera[] = [
  { id: 'cam-001', name: 'I-5 NB / Exit 289', url: '' },
  { id: 'cam-002', name: 'I-5 SB / Nyberg Rd', url: '' },
  { id: 'cam-003', name: 'I-5 / 99W Interchange', url: '' },
  { id: 'cam-004', name: 'Tualatin-Sherwood / 99W', url: '' },
  { id: 'cam-005', name: 'Boones Ferry / Sagert', url: '' },
  { id: 'cam-006', name: 'Martinazzi / Wilsonville Rd', url: '' },
]

export function InfrastructureGrid() {
  const {
    cameras, trafficFlow, utilityStatus, ldiMode, setLdiMode,
    selectedCamId, setSelectedCamId,
    favoriteCamIds, toggleFavoriteCam,
  } = useCivicStore()
  const [radiusKm, setRadiusKm] = useState(5)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 9

  const closeModal = () => {
    setSelectedCamId(null)
  }

  // Filter by radius, then sort favorites to top
  const allCameras = cameras.length > 0 ? cameras : PLACEHOLDER_CAMERAS
  const filteredCameras = allCameras
    .filter((cam) => !cam.dist_km || cam.dist_km <= radiusKm)
    .sort((a, b) => {
      const aFav = favoriteCamIds.includes(a.id) ? 0 : 1
      const bFav = favoriteCamIds.includes(b.id) ? 0 : 1
      return aFav - bFav
    })

  const totalPages = Math.ceil(filteredCameras.length / PAGE_SIZE)
  const displayCameras = filteredCameras.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Helper to get flow status
  const getFlowStatus = (road: string, minSpeed: number = 45) => {
    const sensor = trafficFlow.find(f => f.road?.includes(road) || f.loc?.includes(road))
    if (!sensor) return { value: 'No Data', status: 'warn' as const }
    const speed = sensor.speed || 0
    if (speed === 0) return { value: 'Stopped', status: 'down' as const }
    if (speed < minSpeed) return { value: `${speed} MPH`, status: 'warn' as const }
    return { value: 'Normal Flow', status: 'ok' as const }
  }

  const pge = utilityStatus || {
    status: 'Operational',
    active_outages: 0,
    customers_affected: 0,
    last_updated: '—',
  }

  return (
    <div
      className="relative w-full h-full bg-onyx-black/95 backdrop-blur-sm z-10 flex flex-col overflow-hidden"
      role="region"
      aria-label="Infrastructure panel"
    >

      {/* Panel header */}
      <div className="px-4 py-3 border-b border-amber-gold-muted flex items-center gap-4 shrink-0">
        <span
          className="ms text-[18px] text-amber-gold leading-none"
          aria-hidden="true"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          traffic
        </span>
        <h2 className="font-bold text-sm uppercase tracking-tight text-on-surface">
          Infrastructure Monitor
        </h2>

        {/* LDI toggle */}
        <div className="ml-auto flex items-center gap-2">
          <span className="label-caps">LDI</span>
          <button
            onClick={() => setLdiMode(!ldiMode)}
            className={`
              relative w-9 h-5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-gold
              ${ldiMode ? 'bg-amber-gold' : 'bg-surface-container-highest border border-amber-gold-muted'}
            `}
            role="switch"
            aria-checked={ldiMode}
            aria-label="Toggle last daylight image mode"
          >
            <span
              className={`
                absolute top-0.5 w-4 h-4 bg-onyx-black transition-all
                ${ldiMode ? 'left-[calc(100%-18px)]' : 'left-0.5'}
              `}
            />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-6 content-start">

        {/* CCTV grid */}
        <section aria-labelledby="cctv-heading">
          <div className="flex items-center justify-between mb-3">
            <h3 id="cctv-heading" className="section-heading">
              <span className="ms text-[14px] leading-none" aria-hidden="true">videocam</span>
              Traffic Cameras
            </h3>
            
            {/* Radius filter */}
            <div className="flex items-center gap-1 bg-surface-container-highest/50 p-0.5 rounded-sm">
              {[5, 10, 20].map((r) => (
                <button
                  key={r}
                  onClick={() => { setRadiusKm(r); setPage(0); }}
                  className={`
                    px-2 py-0.5 font-mono text-[9px] uppercase transition-colors
                    ${radiusKm === r ? 'bg-amber-gold text-onyx-black font-bold' : 'text-on-surface-variant hover:text-on-surface'}
                  `}
                >
                  {r}km
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {displayCameras.map((cam) => (
              <div key={cam.id} className="cursor-pointer" onClick={() => setSelectedCamId(cam.id)}>
                <CctvThumbnail
                  cam={cam}
                  ldi={ldiMode}
                  isFavorite={favoriteCamIds.includes(cam.id)}
                  onToggleFavorite={(e) => { e.stopPropagation(); toggleFavoriteCam(cam.id) }}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-3">
             <p className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest">
              {filteredCameras.length} units in range
            </p>
            
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button 
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  className="ms text-[16px] text-on-surface-variant disabled:opacity-20 hover:text-amber-gold transition-colors"
                >
                  chevron_left
                </button>
                <span className="font-mono text-[9px] text-amber-gold">
                  {page + 1} / {totalPages}
                </span>
                <button 
                  disabled={page === totalPages - 1}
                  onClick={() => setPage(p => p + 1)}
                  className="ms text-[16px] text-on-surface-variant disabled:opacity-20 hover:text-amber-gold transition-colors"
                >
                  chevron_right
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Utility status */}
        <section aria-labelledby="utility-heading">
          <h3 id="utility-heading" className="section-heading mb-3">
            <span className="ms text-[14px] leading-none" aria-hidden="true">bolt</span>
            Utility Status
          </h3>
          <div className="hud-panel p-3 mb-4">
            <div className="label-caps mb-2">PGE POWER GRID</div>
            <UtilityStatusRow label="System Status"      value={pge.status}              status={pge.active_outages > 0 ? 'warn' : 'ok'}   />
            <UtilityStatusRow label="Active Outages"     value={String(pge.active_outages)} status={pge.active_outages > 0 ? 'warn' : 'ok'}   />
            <UtilityStatusRow label="Customers Affected" value={pge.customers_affected > 0 ? String(pge.customers_affected) : '—'} status={pge.customers_affected > 0 ? 'warn' : 'ok'}   />
            <UtilityStatusRow label="Last Updated"       value={pge.last_updated}        status="ok"   />
          </div>

          <h3 className="section-heading mb-3">
            <span className="ms text-[14px] leading-none" aria-hidden="true">local_gas_station</span>
            Road & Traffic
          </h3>
          <div className="hud-panel p-3">
            <UtilityStatusRow label="I-5 Northbound"    {...getFlowStatus('I-5')}   />
            <UtilityStatusRow label="I-5 Southbound"    {...getFlowStatus('I-5')}   />
            <UtilityStatusRow label="OR-99W"            {...getFlowStatus('99W')}   />
            <UtilityStatusRow label="Boones Ferry Rd"   {...getFlowStatus('Boones Ferry')}   />
          </div>
        </section>
      </div>
    </div>
  )
}
