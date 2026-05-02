import { useEffect, useState, useCallback } from 'react'
import { useCivicStore } from '../../store'
import { notificationPermission, requestNotificationPermission } from '../../notifications'
import { getUserRole, clearToken, authHeaders } from '../../auth'
import { API_BASE } from '../../config'

export function SettingsPanel() {
  const {
    settingsOpen, setSettingsOpen,
    radarVisible, setRadarVisible,
    radarOpacity, setRadarOpacity,
    smokeVisible, setSmokeVisible,
    camerasVisible, setCamerasVisible,
    geofencesVisible, setGeofencesVisible,
    entityFilter, setEntityFilter,
  } = useCivicStore()

  const [notifPermission, setNotifPermission] = useState(() => notificationPermission())
  const userRole = getUserRole()


  // System metrics (admin only)
  type MetricsData = {
    available: boolean
    req_rate: number
    error_pct: number
    memory_mb: number
    cpu_pct: number
    p95_ms: number
    history: Array<{ ts: number; req_rate: number; error_pct: number; memory_mb: number; p95_ms: number }>
  }
  const [metricsData, setMetricsData] = useState<MetricsData | null>(null)

  const loadMetrics = useCallback(async () => {
    if (userRole !== 'admin') return
    try {
      const res = await fetch(`${API_BASE}/admin/metrics`, { headers: authHeaders() })
      if (res.ok) setMetricsData(await res.json())
    } catch { /* non-fatal */ }
  }, [userRole])

  // Alert rules (admin only)
  const [alertRules, setAlertRules] = useState<Array<{
    id: number
    name: string
    enabled: boolean
    trigger_type: 'geofence_entry' | 'severity_threshold' | 'entity_type'
    action_type: 'webhook_post' | 'log'
    action_config: Record<string, unknown>
  }>>([])
  const [newRuleName, setNewRuleName] = useState('')
  const [newRuleTrigger, setNewRuleTrigger] = useState<'geofence_entry' | 'severity_threshold' | 'entity_type'>('severity_threshold')
  const [newRuleAction, setNewRuleAction] = useState<'webhook_post' | 'log'>('webhook_post')
  const [newRuleUrl, setNewRuleUrl] = useState('')

  const loadAlertRules = useCallback(async () => {
    if (userRole !== 'admin') return
    try {
      const res = await fetch(`${API_BASE}/alertrules`, { headers: authHeaders() })
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setAlertRules(data)
    } catch { /* non-fatal */ }
  }, [userRole])

  useEffect(() => {
    if (settingsOpen) {
      loadAlertRules()
      loadMetrics()
    }
  }, [settingsOpen, loadAlertRules, loadMetrics])

  const createAlertRule = async () => {
    if (!newRuleName.trim()) return
    if (newRuleAction === 'webhook_post' && !newRuleUrl.trim()) return
    try {
      const payload = {
        name: newRuleName.trim(),
        enabled: true,
        trigger_type: newRuleTrigger,
        rule_filter: newRuleTrigger === 'severity_threshold' ? { min_severity: 'high' } : {},
        action_type: newRuleAction,
        action_config: newRuleAction === 'webhook_post' ? { url: newRuleUrl.trim() } : {},
      }
      const res = await fetch(`${API_BASE}/alertrules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return
      setNewRuleName('')
      setNewRuleUrl('')
      await loadAlertRules()
    } catch { /* non-fatal */ }
  }

  const toggleAlertRule = async (id: number, enabled: boolean) => {
    try {
      await fetch(`${API_BASE}/alertrules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled: !enabled }),
      })
      await loadAlertRules()
    } catch { /* non-fatal */ }
  }

  const deleteAlertRule = async (id: number) => {
    try {
      await fetch(`${API_BASE}/alertrules/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      await loadAlertRules()
    } catch { /* non-fatal */ }
  }

  // Close on Escape
  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [settingsOpen, setSettingsOpen])

  const handleNotifToggle = async () => {
    if (notifPermission === 'granted') return  // browser doesn't allow revocation via JS
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
            <span className={`px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest border ${userRole === 'admin' ? 'border-amber-gold/40 text-amber-gold/70' : 'border-green-ais/40 text-green-ais/70'}`}>
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
                label="Smoke Overlay"
                icon="air"
                checked={smokeVisible}
                onChange={setSmokeVisible}
              />
              <ToggleRow
                label="Cameras"
                icon="videocam"
                checked={camerasVisible}
                onChange={setCamerasVisible}
              />
              <ToggleRow
                label="Zone Monitor"
                icon="verified_user"
                checked={geofencesVisible}
                onChange={setGeofencesVisible}
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

          {/* Notifications */}
          {notifPermission !== 'unsupported' && (
            <section>
              <h2 className="label-caps mb-3">Notifications</h2>
              <div className="space-y-3">
                {notifPermission === 'denied' ? (
                  <p className="text-[10px] text-on-surface-variant leading-relaxed">
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
                    <span className={`flex-1 font-bold text-[10px] tracking-widest uppercase transition-colors ${notifPermission === 'granted' ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
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
              <ToggleRow
                label="APRS"
                icon="sensors"
                checked={entityFilter.aprs}
                onChange={(v) => setEntityFilter({ aprs: v })}
              />
              <ToggleRow
                label="Fire Incidents"
                icon="local_fire_department"
                checked={entityFilter.fire_incident}
                onChange={(v) => setEntityFilter({ fire_incident: v })}
              />
            </div>
          </section>

          {/* Data Retention — admin only */}
          {/* Alert Rules — admin only */}
          {userRole === 'admin' && (
            <section>
              <h2 className="label-caps mb-3">Alert Rules</h2>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Rule name"
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  className="w-full bg-onyx-deep border border-white/10 text-on-surface placeholder-on-surface-variant text-[11px] px-3 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newRuleTrigger}
                    onChange={(e) => setNewRuleTrigger(e.target.value as 'geofence_entry' | 'severity_threshold' | 'entity_type')}
                    className="bg-onyx-deep border border-white/10 text-on-surface text-[10px] px-2 py-1.5 focus:outline-none"
                  >
                    <option value="severity_threshold">Severity</option>
                    <option value="geofence_entry">Geofence Entry</option>
                    <option value="entity_type">Entity Type</option>
                  </select>
                  <select
                    value={newRuleAction}
                    onChange={(e) => setNewRuleAction(e.target.value as 'webhook_post' | 'log')}
                    className="bg-onyx-deep border border-white/10 text-on-surface text-[10px] px-2 py-1.5 focus:outline-none"
                  >
                    <option value="webhook_post">Webhook</option>
                    <option value="log">Log Only</option>
                  </select>
                </div>
                {newRuleAction === 'webhook_post' && (
                  <input
                    type="url"
                    placeholder="Webhook URL"
                    value={newRuleUrl}
                    onChange={(e) => setNewRuleUrl(e.target.value)}
                    className="w-full bg-onyx-deep border border-white/10 text-on-surface placeholder-on-surface-variant text-[11px] px-3 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
                  />
                )}
                <button
                  onClick={createAlertRule}
                  className="w-full py-1.5 text-[9px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 transition-colors focus:outline-none"
                >
                  Add Rule
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {alertRules.length === 0 ? (
                  <p className="text-[10px] text-on-surface-variant">No alert rules configured.</p>
                ) : (
                  alertRules.map((rule) => (
                    <div key={rule.id} className="border border-white/10 bg-onyx-black/30 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-on-surface font-bold truncate">{rule.name}</span>
                        <button
                          onClick={() => toggleAlertRule(rule.id, rule.enabled)}
                          className={`text-[8px] uppercase tracking-widest border px-1.5 py-0.5 ${rule.enabled ? 'text-green-ais border-green-ais/40' : 'text-on-surface-variant border-white/20'}`}
                        >
                          {rule.enabled ? 'On' : 'Off'}
                        </button>
                      </div>
                      <div className="text-[8px] text-on-surface-variant uppercase tracking-widest mt-1">
                        {rule.trigger_type.replace('_', ' ')} · {rule.action_type.replace('_', ' ')}
                      </div>
                      <button
                        onClick={() => deleteAlertRule(rule.id)}
                        className="mt-1 text-[9px] text-red-emergency hover:text-red-emergency/80 uppercase tracking-widest"
                      >
                        Delete
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {/* Admin Dashboard link */}
          {userRole === 'admin' && (
            <section>
              <a
                href="/admin"
                className="flex items-center justify-between w-full py-2 px-3 border border-amber-gold/30 text-amber-gold/80 hover:bg-amber-gold/10 transition-colors text-[10px] uppercase tracking-widest"
              >
                <span>Admin Dashboard</span>
                <span className="ms text-[14px]">open_in_new</span>
              </a>
            </section>
          )}

          {/* System Metrics — admin only */}
          {userRole === 'admin' && (
            <section>
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
                <p className="text-[10px] text-on-surface-variant">Loading…</p>
              ) : !metricsData.available ? (
                <p className="text-[10px] text-on-surface-variant">
                  No data yet — metrics collect every 10s after startup.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <MetricCard label="Req / s" value={metricsData.req_rate.toFixed(1)} unit="" icon="arrow_forward" />
                    <MetricCard
                      label="Error %"
                      value={metricsData.error_pct.toFixed(1)}
                      unit="%"
                      icon="warning"
                      warn={metricsData.error_pct > 2}
                    />
                    <MetricCard label="P95 Latency" value={metricsData.p95_ms.toFixed(0)} unit="ms" icon="timer" warn={metricsData.p95_ms > 500} />
                    <MetricCard label="Memory" value={metricsData.memory_mb.toFixed(0)} unit="MB" icon="memory" warn={metricsData.memory_mb > 400} />
                  </div>
                  {metricsData.history.length >= 2 && (
                    <div>
                      <div className="text-[8px] text-on-surface-variant uppercase tracking-widest mb-1">Req/s — last 6 min</div>
                      <Sparkline values={metricsData.history.map((h) => h.req_rate)} />
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Account */}
          <section className="border-t border-white/10 pt-4">
            <h2 className="label-caps mb-3">Account</h2>
            <button
              onClick={() => { clearToken(); window.location.reload() }}
              className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant hover:text-red-emergency transition-colors focus:outline-none"
            >
              <span className="ms text-[16px] leading-none">logout</span>
              Sign Out
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, unit, icon, warn = false }: {
  label: string; value: string; unit: string; icon: string; warn?: boolean
}) {
  return (
    <div className="hud-panel p-2 text-center space-y-0.5">
      <span className={`ms text-[14px] leading-none ${warn ? 'text-red-emergency' : 'text-amber-gold'}`} aria-hidden="true">
        {icon}
      </span>
      <div className={`font-mono text-[13px] font-bold leading-tight ${warn ? 'text-red-emergency' : 'text-on-surface'}`}>
        {value}<span className="text-[9px] text-on-surface-variant ml-0.5">{unit}</span>
      </div>
      <div className="text-on-surface-variant uppercase tracking-wider text-[7px]">{label}</div>
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const w = 220
  const h = 28
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 4) - 2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} className="w-full overflow-visible" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="#FFB800" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
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
