import { useState } from 'react'
import { useCivicStore, TrafficCamera } from '../../store'

function CctvThumbnail({ cam, ldi }: { cam: TrafficCamera; ldi: boolean }) {
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
  const { cameras, ldiMode, setLdiMode } = useCivicStore()
  const [radiusKm, setRadiusKm] = useState(5)
  const [page, setPage] = useState(0)
  const [selectedCam, setSelectedCam] = useState<TrafficCamera | null>(null)
  const PAGE_SIZE = 9

  // Filter cameras by radius
  const filteredCameras = (cameras.length > 0 ? cameras : PLACEHOLDER_CAMERAS).filter(
    cam => !cam.dist_km || cam.dist_km <= radiusKm
  )

  const totalPages = Math.ceil(filteredCameras.length / PAGE_SIZE)
  const displayCameras = filteredCameras.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div
      className="relative w-full h-full bg-onyx-black/95 backdrop-blur-sm z-10 flex flex-col overflow-hidden"
      role="region"
      aria-label="Infrastructure panel"
    >

      {/* Camera Pop-out Modal */}
      {selectedCam && (
        <div 
          className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-onyx-black/80 backdrop-blur-md animate-in fade-in zoom-in duration-200"
          onClick={() => setSelectedCam(null)}
        >
          <div 
            className="hud-panel w-full max-w-3xl overflow-hidden pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-amber-gold-muted flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="ms text-[18px] text-amber-gold">videocam</span>
                <span className="font-bold text-sm uppercase tracking-tight text-on-surface truncate">
                  {selectedCam.name}
                </span>
              </div>
              <button 
                onClick={() => setSelectedCam(null)}
                className="ms text-[20px] text-on-surface-variant hover:text-amber-gold transition-colors"
              >
                close
              </button>
            </div>
            <div className="aspect-video bg-surface-container relative">
              <img 
                src={ldiMode && selectedCam.ldi_url ? selectedCam.ldi_url : selectedCam.url} 
                alt={selectedCam.name}
                className="w-full h-full object-contain"
              />
              <div className="absolute top-4 left-4 flex flex-col gap-1">
                <div className="bg-onyx-black/60 px-2 py-1 rounded-sm border border-white/10">
                   <span className="font-mono text-[10px] text-amber-gold">LIVE FEED • {selectedCam.dist_km}km</span>
                </div>
                {selectedCam.road && (
                  <div className="bg-onyx-black/60 px-2 py-1 rounded-sm border border-white/10 w-fit">
                    <span className="font-mono text-[10px] text-on-surface-variant uppercase">{selectedCam.road}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="p-3 border-t border-amber-gold-muted/30 bg-white/[0.02] flex items-center justify-between">
               <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest">
                 System: ODOT TRIPCHECK • ID: {selectedCam.id}
               </span>
               <button 
                 onClick={() => setSelectedCam(null)}
                 className="px-4 py-1.5 bg-amber-gold text-onyx-black font-bold text-[10px] uppercase tracking-tighter hover:bg-amber-400 transition-colors"
               >
                 Acknowledge
               </button>
            </div>
          </div>
        </div>
      )}

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
              <div key={cam.id} className="cursor-pointer" onClick={() => setSelectedCam(cam)}>
                <CctvThumbnail cam={cam} ldi={ldiMode} />
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
            <UtilityStatusRow label="System Status"      value="Operational"        status="ok"   />
            <UtilityStatusRow label="Active Outages"     value="0"                  status="ok"   />
            <UtilityStatusRow label="Customers Affected" value="—"                  status="ok"   />
            <UtilityStatusRow label="Last Updated"       value="—"                  status="ok"   />
          </div>

          <h3 className="section-heading mb-3">
            <span className="ms text-[14px] leading-none" aria-hidden="true">local_gas_station</span>
            Road & Traffic
          </h3>
          <div className="hud-panel p-3">
            <UtilityStatusRow label="I-5 Northbound"    value="Normal Flow"   status="ok"   />
            <UtilityStatusRow label="I-5 Southbound"    value="Normal Flow"   status="ok"   />
            <UtilityStatusRow label="OR-99W"            value="Normal Flow"   status="ok"   />
            <UtilityStatusRow label="Boones Ferry Rd"   value="Normal Flow"   status="ok"   />
          </div>
        </section>
      </div>
    </div>
  )
}
