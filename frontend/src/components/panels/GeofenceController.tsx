import { useState } from 'react'
import { GeofencePanel } from './GeofencePanel'

export function GeofenceController() {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`
          relative flex items-center gap-2 px-3 py-2
          hud-panel border border-amber-gold-muted text-[10px] font-mono uppercase tracking-widest shadow-2xl
          hover:border-amber-gold/60 transition-colors focus:outline-none
          ${open ? 'text-amber-gold border-amber-gold' : 'text-on-surface-variant'}
        `}
        aria-expanded={open}
        title="Geofence Zones Editor"
      >
        <span className="ms text-[16px] leading-none">pentagon</span>
        ZONES
      </button>

      {/* Editor Panel — shown when trigger clicked */}
      {open && (
        <div className="fixed top-28 right-4 z-[40] w-[420px] max-h-[calc(100vh-16rem)] overflow-y-auto hud-panel p-4 cursor-default">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="ms text-[16px] text-amber-gold leading-none">pentagon</span>
              <span className="font-bold text-[10px] tracking-[0.2em] uppercase text-amber-gold">Geofence Editor</span>
            </div>
            <button 
              onClick={() => setOpen(false)} 
              className="ms text-[16px] text-on-surface-variant hover:text-on-surface leading-none focus:outline-none"
              title="Close editor"
            >
              close
            </button>
          </div>
          <GeofencePanel />
        </div>
      )}
    </div>
  )
}
