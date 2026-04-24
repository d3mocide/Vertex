import { useEffect } from 'react'
import { useCivicStore } from '../../store'

export function SettingsPanel() {
  const {
    settingsOpen, setSettingsOpen,
    radarVisible, setRadarVisible,
    radarOpacity, setRadarOpacity,
    camerasVisible, setCamerasVisible,
    entityFilter, setEntityFilter,
  } = useCivicStore()

  // Close on Escape
  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [settingsOpen, setSettingsOpen])

  if (!settingsOpen) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Settings">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-onyx-black/60 backdrop-blur-sm"
        onClick={() => setSettingsOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="absolute right-0 top-0 bottom-0 w-72 bg-onyx-deep border-l border-white/10 flex flex-col shadow-[−8px_0_32px_rgba(0,0,0,0.6)]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="ms text-[18px] text-amber-gold" aria-hidden="true">settings</span>
            <span className="font-bold text-[11px] tracking-[0.2em] uppercase text-amber-gold">SETTINGS</span>
          </div>
          <button
            onClick={() => setSettingsOpen(false)}
            className="text-on-surface-variant hover:text-amber-gold transition-colors p-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
            aria-label="Close settings"
          >
            <span className="ms text-[22px]">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-4 px-5 space-y-6">

          {/* Map Layers */}
          <section>
            <h2 className="label-caps mb-3">Map Layers</h2>
            <div className="space-y-3">
              <ToggleRow
                label="Radar"
                icon="radar"
                checked={radarVisible}
                onChange={setRadarVisible}
              />
              <ToggleRow
                label="Cameras"
                icon="videocam"
                checked={camerasVisible}
                onChange={setCamerasVisible}
              />
            </div>
          </section>

          {/* Radar */}
          {radarVisible && (
            <section>
              <h2 className="label-caps mb-3">Radar Opacity</h2>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] text-on-surface-variant w-8">{Math.round(radarOpacity * 100)}%</span>
                <div className="relative flex-1 h-1 bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className="absolute left-0 top-0 bottom-0 bg-amber-gold"
                    style={{ width: `${radarOpacity * 100}%` }}
                    aria-hidden="true"
                  />
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={radarOpacity}
                    onChange={(e) => setRadarOpacity(parseFloat(e.target.value))}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer"
                    aria-label="Radar opacity"
                    aria-valuemin={10}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(radarOpacity * 100)}
                  />
                </div>
              </div>
            </section>
          )}

          {/* Entity Types */}
          <section>
            <h2 className="label-caps mb-3">Entity Types</h2>
            <div className="space-y-3">
              <ToggleRow
                label="Aircraft"
                icon="flight"
                checked={entityFilter.aircraft}
                onChange={(v) => setEntityFilter({ aircraft: v })}
              />
              <ToggleRow
                label="Vessels"
                icon="directions_boat"
                checked={entityFilter.vessel}
                onChange={(v) => setEntityFilter({ vessel: v })}
              />
              <ToggleRow
                label="Mesh Nodes"
                icon="hub"
                checked={entityFilter.mesh_node}
                onChange={(v) => setEntityFilter({ mesh_node: v })}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function ToggleRow({ label, icon, checked, onChange }: {
  label: string
  icon: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const id = `setting-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <label htmlFor={id} className="flex items-center gap-3 cursor-pointer group">
      <span className={`ms text-[18px] leading-none transition-colors ${checked ? 'text-amber-gold' : 'text-on-surface-variant group-hover:text-on-surface'}`} aria-hidden="true">
        {icon}
      </span>
      <span className={`flex-1 font-bold text-[10px] tracking-widest uppercase transition-colors ${checked ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
        {label}
      </span>
      {/* Toggle switch */}
      <div className="relative shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div className={`w-9 h-5 border transition-colors ${checked ? 'bg-amber-gold/20 border-amber-gold' : 'bg-surface-container border-outline-variant'}`} />
        <div className={`absolute top-0.5 h-4 w-4 border transition-all ${checked ? 'translate-x-4 bg-amber-gold border-amber-gold' : 'translate-x-0.5 bg-on-surface-variant border-on-surface-variant'}`} />
      </div>
    </label>
  )
}
