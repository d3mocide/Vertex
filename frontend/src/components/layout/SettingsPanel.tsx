import { useEffect, useState, useCallback } from 'react'
import { useCivicStore } from '../../store'
import { notificationPermission, requestNotificationPermission } from '../../notifications'
import { getUserRole, clearToken, authHeaders } from '../../auth'
import { API_BASE } from '../../config'
import { ToggleRow, MetricCard, Sparkline, type MetricsData } from './SettingsPrimitives'
import { AlertRulesSection } from './AlertRulesSection'

export function SettingsPanel() {
  const {
    settingsOpen, setSettingsOpen,
    radarVisible, setRadarVisible,
    radarOpacity, setRadarOpacity,
    smokeVisible, setSmokeVisible,
    goesVisible, setGoesVisible,
    firePerimetersVisible, setFirePerimetersVisible,
    camerasVisible, setCamerasVisible,
    geofencesVisible, setGeofencesVisible,
    trailsVisible, setTrailsVisible,
    lightningVisible, setLightningVisible,
    radarReflectivityVisible, setRadarReflectivityVisible,
    nwsAlertsVisible, setNwsAlertsVisible,
    lightningDensityVisible, setLightningDensityVisible,
    railTracksVisible, setRailTracksVisible,
    gaugesVisible, setGaugesVisible,
    terrainEnabled, setTerrainEnabled,
    terrainExaggeration, setTerrainExaggeration,
    entityFilter, setEntityFilter,
    debugInsets, setDebugInsets,
  } = useCivicStore()

  const [notifPermission, setNotifPermission] = useState(() => notificationPermission())
  const userRole = getUserRole()

  const [metricsData, setMetricsData] = useState<MetricsData | null>(null)

  const loadMetrics = useCallback(async () => {
    if (userRole !== 'admin') return
    try {
      const res = await fetch(`${API_BASE}/admin/metrics`, { headers: authHeaders() })
      if (res.ok) setMetricsData(await res.json())
    } catch { /* non-fatal */ }
  }, [userRole])

  useEffect(() => {
    if (settingsOpen) loadMetrics()
  }, [settingsOpen, loadMetrics])

  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [settingsOpen, setSettingsOpen])

  const handleNotifToggle = async () => {
    if (notifPermission === 'granted') return
    const granted = await requestNotificationPermission()
    setNotifPermission(granted ? 'granted' : 'denied')
  }

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
            <span className={`px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-widest border ${userRole === 'admin' ? 'border-amber-gold/40 text-amber-gold/70' : 'border-green-ais/40 text-green-ais/70'}`}>
              {userRole}
            </span>
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

          {/* Account — top */}
          <section>
            <h2 className="label-caps mb-3">Account</h2>
            <div className="space-y-3">
              <button
                onClick={() => { clearToken(); window.location.reload() }}
                className="flex items-center gap-2 w-full py-2 px-3 border border-red-emergency/30 text-red-emergency/80 hover:bg-red-emergency/10 transition-colors text-[11px] font-bold uppercase tracking-widest"
              >
                <span className="ms text-[16px] leading-none">logout</span>
                Sign Out
              </button>
            </div>
          </section>

          {/* Admin Dashboard link — admin only */}
          {userRole === 'admin' && (
            <section>
              <a
                href="/admin"
                className="flex items-center justify-between w-full py-2 px-3 border border-amber-gold/30 text-amber-gold/80 hover:bg-amber-gold/10 transition-colors text-[11px] uppercase tracking-widest"
              >
                <span>Admin Dashboard</span>
                <span className="ms text-[14px]">open_in_new</span>
              </a>
            </section>
          )}

          {/* Divider */}
          {userRole === 'admin' && <div className="border-t border-white/10" />}

          {/* Map Layers */}
          <section>
            <h2 className="label-caps mb-3">Map Layers</h2>
            <div className="space-y-3">
              {/* Weather & Atmospheric */}
              <ToggleRow label="IEM Radar" icon="radar" checked={radarVisible} onChange={setRadarVisible} />
              <ToggleRow label="NOAA Radar" icon="radar" checked={radarReflectivityVisible} onChange={setRadarReflectivityVisible} />
              <ToggleRow label="GOES Satellite" icon="satellite_alt" checked={goesVisible} onChange={setGoesVisible} />
              <ToggleRow label="NWS Alerts" icon="notification_important" checked={nwsAlertsVisible} onChange={setNwsAlertsVisible} />
              <ToggleRow label="Lightning" icon="bolt" checked={lightningVisible} onChange={setLightningVisible} />
              <ToggleRow label="Lightning Density" icon="electric_bolt" checked={lightningDensityVisible} onChange={setLightningDensityVisible} />
              <ToggleRow label="Smoke Overlay" icon="air" checked={smokeVisible} onChange={setSmokeVisible} />

              {/* Hazards & Environmental */}
              <ToggleRow label="Fire Perimeters" icon="local_fire_department" checked={firePerimetersVisible} onChange={setFirePerimetersVisible} />
              <ToggleRow label="Stream Gauges" icon="water" checked={gaugesVisible} onChange={setGaugesVisible} />

              {/* Operational & Tactical */}
              <ToggleRow label="Zone Monitor" icon="verified_user" checked={geofencesVisible} onChange={setGeofencesVisible} />

              {/* Map Foundation */}
              <ToggleRow label="3D Terrain" icon="landscape" checked={terrainEnabled} onChange={setTerrainEnabled} />
            </div>
          </section>

          {/* Radar Opacity */}
          {radarVisible && (
            <section>
              <h2 className="label-caps mb-3">Radar Opacity</h2>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-on-surface-variant w-8">{Math.round(radarOpacity * 100)}%</span>
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

          {/* Terrain exaggeration */}
          {terrainEnabled && (
            <section>
              <h2 className="label-caps mb-3">Terrain Exaggeration</h2>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-on-surface-variant w-8">{terrainExaggeration.toFixed(1)}×</span>
                <div className="relative flex-1 h-1 bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className="absolute left-0 top-0 bottom-0 bg-amber-gold"
                    style={{ width: `${((terrainExaggeration - 0.5) / 4.5) * 100}%` }}
                    aria-hidden="true"
                  />
                  <input
                    type="range"
                    min={0.5}
                    max={5}
                    step={0.5}
                    value={terrainExaggeration}
                    onChange={(e) => setTerrainExaggeration(parseFloat(e.target.value))}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer"
                    aria-label="Terrain exaggeration"
                  />
                </div>
              </div>
            </section>
          )}

          {/* Notifications */}
          {notifPermission !== 'unsupported' && (
            <section>
              <h2 className="label-caps mb-3">Notifications</h2>
              <div className="space-y-3">
                {notifPermission === 'denied' ? (
                  <p className="text-[11px] text-on-surface-variant leading-relaxed">
                    Notifications blocked by browser. Enable them in browser site settings.
                  </p>
                ) : (
                  <button
                    onClick={handleNotifToggle}
                    disabled={notifPermission === 'granted'}
                    className={`flex items-center gap-3 w-full text-left group ${notifPermission === 'granted' ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <span className={`ms text-[18px] leading-none transition-colors ${notifPermission === 'granted' ? 'text-amber-gold' : 'text-on-surface-variant group-hover:text-on-surface'}`} aria-hidden="true">
                      notifications
                    </span>
                    <span className={`flex-1 font-bold text-[11px] tracking-widest uppercase transition-colors ${notifPermission === 'granted' ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
                      {notifPermission === 'granted' ? 'Notifications On' : 'Enable Notifications'}
                    </span>
                    {notifPermission === 'granted' && (
                      <span className="ms text-[14px] text-amber-gold leading-none">check_circle</span>
                    )}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Entity Types */}
          <section>
            <h2 className="label-caps mb-3">Entity Types</h2>
            <div className="space-y-3">
              <ToggleRow label="Aircraft" icon="flight" checked={entityFilter.aircraft} onChange={(v) => setEntityFilter({ aircraft: v })} />
              <ToggleRow label="Vessels" icon="sailing" checked={entityFilter.vessel} onChange={(v) => setEntityFilter({ vessel: v })} />
              <ToggleRow label="Trains" icon="directions_railway" checked={entityFilter.train} onChange={(v) => setEntityFilter({ train: v })} />
              <ToggleRow label="Rail Tracks" icon="route" checked={railTracksVisible} onChange={setRailTracksVisible} />
              <ToggleRow label="Mesh Nodes" icon="hub" checked={entityFilter.mesh_node} onChange={(v) => setEntityFilter({ mesh_node: v })} />
              <ToggleRow label="APRS" icon="sensors" checked={entityFilter.aprs} onChange={(v) => setEntityFilter({ aprs: v })} />
              <ToggleRow label="Fire Incidents" icon="local_fire_department" checked={entityFilter.fire_incident} onChange={(v) => setEntityFilter({ fire_incident: v })} />
              <ToggleRow label="Cameras" icon="videocam" checked={camerasVisible} onChange={setCamerasVisible} />
              <ToggleRow label="History Trails" icon="timeline" checked={trailsVisible} onChange={setTrailsVisible} />
            </div>
          </section>

          {/* Developer tools — admin only */}
          {userRole === 'admin' && (
            <section>
              <h2 className="label-caps mb-3">Developer</h2>
              <div className="space-y-3">
                <ToggleRow
                  label="Debug Mode"
                  icon="bug_report"
                  checked={debugInsets}
                  onChange={setDebugInsets}
                />
              </div>
              <p className="mt-2 text-[11px] text-on-surface-variant leading-relaxed">
                Overlays live safe-area insets, viewport metrics &amp; DOM-layer heights. Toggle off to exit debug mode.
              </p>
            </section>
          )}

          {/* Alert Rules — admin only */}
          {userRole === 'admin' && <AlertRulesSection open={settingsOpen} />}

          {/* System Metrics — admin only, bottom */}
          {userRole === 'admin' && (
            <section className="border-t border-white/10 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="label-caps">System Metrics</h2>
                <button
                  onClick={loadMetrics}
                  className="ms text-[14px] text-on-surface-variant hover:text-on-surface transition-colors leading-none focus:outline-none"
                  title="Refresh"
                >
                  sync
                </button>
              </div>
              {!metricsData ? (
                <p className="text-[11px] text-on-surface-variant">Loading…</p>
              ) : !metricsData.available ? (
                <p className="text-[11px] text-on-surface-variant">
                  No data yet — metrics collect every 10s after startup.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCard label="Req / s" value={metricsData.req_rate.toFixed(1)} unit="" icon="arrow_forward" />
                    <MetricCard label="Error %" value={metricsData.error_pct.toFixed(1)} unit="%" icon="warning" warn={metricsData.error_pct > 2} />
                    <MetricCard label="P95 Latency" value={metricsData.p95_ms.toFixed(0)} unit="ms" icon="timer" warn={metricsData.p95_ms > 500} />
                    <MetricCard label="Memory" value={metricsData.memory_mb.toFixed(0)} unit="MB" icon="memory" warn={metricsData.memory_mb > 400} />
                  </div>
                  {metricsData.history.length >= 2 && (
                    <div>
                      <div className="text-[11px] text-on-surface-variant uppercase tracking-widest mb-1">Req/s — last 6 min</div>
                      <Sparkline values={metricsData.history.map((h) => h.req_rate)} />
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
