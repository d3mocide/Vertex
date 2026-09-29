import { useState, useEffect } from 'react'
import { TrafficCamera, useCivicPick } from '../../store'
import { triageIncidents } from '../../incidentUtils'
import { IncidentsNow } from './infrastructure/IncidentsNow'
import { PlannedWork } from './infrastructure/PlannedWork'
import { RoadStatusCard } from './infrastructure/RoadStatusCard'
import { MessageSignsCard } from './infrastructure/MessageSignsCard'
import { PowerCard } from './infrastructure/PowerCard'
import { PageHeader } from '../common/Page'

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

  const healthDot: Record<string, string> = {
    ok:      'bg-green-ais',
    warn:    'bg-amber-gold animate-pulse',
    down:    'bg-red-emergency animate-pulse',
    unknown: 'bg-on-surface-variant',
  }
  const healthTitle: Record<string, string> = {
    ok:      'Feed reachable',
    warn:    'Feed returned error',
    down:    'Feed unreachable',
    unknown: 'Health unknown',
  }
  const dot = cam.health ? healthDot[cam.health] ?? healthDot.unknown : null

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
          <span className="font-mono text-[11px] text-on-surface-variant uppercase">
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
        className="absolute top-0 left-0 p-2 lg:top-1 lg:left-1 lg:p-0.5 text-amber-gold hover:scale-110 transition-transform"
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        title={isFavorite ? 'Remove from favorites' : 'Bookmark feed'}
      >
        <span
          className="ms text-[20px] lg:text-[16px] leading-none"
          aria-hidden="true"
          style={{ fontVariationSettings: `'FILL' ${isFavorite ? 1 : 0}` }}
        >
          bookmark
        </span>
      </button>
      {/* Camera label overlay */}
      <div className="absolute bottom-0 left-0 right-0 px-2 pt-5 pb-1 flex items-center justify-between bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <span className="text-[12px] font-semibold text-on-surface truncate mr-1">
          {cam.name}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {cam.dist_km && (
            <span className="font-mono text-[11px] text-on-surface/70">
              {cam.dist_km}km
            </span>
          )}
          {dot && (
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`}
              title={cam.health ? healthTitle[cam.health] : ''}
              aria-label={cam.health ? healthTitle[cam.health] : ''}
            />
          )}
        </div>
      </div>
      {ldi && cam.ldi_url && (
        <div className="absolute top-1 right-1 bg-amber-gold-muted px-1 py-0.5">
          <span className="font-mono text-[11px] text-amber-gold uppercase">LDI</span>
        </div>
      )}
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
    cameras,
    trafficIncidents,
    oregonStatus,
    ldiMode,
    setLdiMode,
    selectedCamId,
    setSelectedCamId,
    favoriteCamIds,
    toggleFavoriteCam,
  } = useCivicPick('cameras', 'trafficIncidents', 'oregonStatus', 'ldiMode', 'setLdiMode', 'selectedCamId', 'setSelectedCamId', 'favoriteCamIds', 'toggleFavoriteCam')
  const [radiusKm, setRadiusKm] = useState(5)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 12

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

  // Closures and delays near us first; roadwork/notices folded away.
  const triage = triageIncidents(trafficIncidents)

  const oregon = oregonStatus || {
    status: 'Operational',
    state_affected: 0,
    metro_affected: 0,
    pge_affected: 0,
    pacificorp_affected: 0,
    last_updated: '—',
  }

  return (
    <div
      className="relative w-full h-full z-10 flex flex-col overflow-hidden"
      role="region"
      aria-label="Infrastructure panel"
    >

      <PageHeader
        icon="traffic"
        title="Infrastructure"
        status={<>
          <span className="label-caps" title="Show the last daylight image for night cameras">LDI</span>
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
        </>}
      />

      <div className="flex-1 overflow-y-auto p-4 pb-24 flex flex-col gap-6">

        {/* Right now: what is closed or slow, and how the roads, signs and power look */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <IncidentsNow groups={triage.now} cameras={allCameras} onOpenCamera={setSelectedCamId} />

          <div className="flex flex-col gap-4">
            <RoadStatusCard />
            <MessageSignsCard />
            <PowerCard
              statewide={oregon.state_affected}
              metro={oregon.metro_affected}
              pge={oregon.pge_affected}
              pacific={oregon.pacificorp_affected}
            />
          </div>
        </div>

        {/* Cameras */}
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
                px-2 py-0.5 font-mono text-[11px] uppercase transition-colors
                ${radiusKm === r ? 'bg-amber-gold text-onyx-black font-bold' : 'text-on-surface-variant hover:text-on-surface'}
              `}
            >
              {r}km
            </button>
          ))}
        </div>
      </div>

      {/* Phones: one swipeable row of every camera in range, so the
          camera wall doesn't push status and incidents off-screen. */}
      <div className="lg:hidden -mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory">
        {filteredCameras.map((cam) => (
          <div key={cam.id} className="w-[78%] shrink-0 snap-start cursor-pointer" onClick={() => setSelectedCamId(cam.id)}>
            <CctvThumbnail
              cam={cam}
              ldi={ldiMode}
              isFavorite={favoriteCamIds.includes(cam.id)}
              onToggleFavorite={(e) => { e.stopPropagation(); toggleFavoriteCam(cam.id) }}
            />
          </div>
        ))}
      </div>

      <div className="hidden lg:grid grid-cols-3 xl:grid-cols-6 gap-2">
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
        <p className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">
          {filteredCameras.length} cameras in range
        </p>

        {/* Pagination (desktop grid; phones swipe the strip) */}
        {totalPages > 1 && (
          <div className="hidden lg:flex items-center gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="ms text-[16px] text-on-surface-variant disabled:opacity-20 hover:text-amber-gold transition-colors"
            >
              chevron_left
            </button>
            <span className="font-mono text-[11px] text-amber-gold">
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

        {/* Roadwork and notices with little impact, folded */}
        <PlannedWork incidents={triage.planned} hiddenStale={triage.hiddenStale} />

      </div>
    </div>
  )
}
