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
      <div className="absolute bottom-0 left-0 right-0 bg-onyx-black/80 px-2 py-1">
        <span className="font-mono text-[9px] text-amber-gold uppercase truncate block">
          {cam.name}
        </span>
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
  const displayCameras = cameras.length > 0 ? cameras : PLACEHOLDER_CAMERAS

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
          <h3 id="cctv-heading" className="section-heading mb-3">
            <span className="ms text-[14px] leading-none" aria-hidden="true">videocam</span>
            ODOT Traffic Cameras
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {displayCameras.map((cam) => (
              <CctvThumbnail key={cam.id} cam={cam} ldi={ldiMode} />
            ))}
          </div>
          <p className="font-mono text-[9px] text-on-surface-variant mt-2 uppercase tracking-widest">
            {displayCameras.length} cameras • Refresh 60s
          </p>
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
