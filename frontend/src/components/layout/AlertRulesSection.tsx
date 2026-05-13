import { useState, useCallback, useEffect } from 'react'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

type AlertRule = {
  id: number
  name: string
  enabled: boolean
  trigger_type: 'geofence_entry' | 'severity_threshold' | 'entity_type' | 'scheduled'
  action_type: 'webhook_post' | 'log' | 'sitrep_delivery'
  action_config: Record<string, unknown>
  cooldown_seconds: number | null
  max_per_hour: number | null
  dedup_key: string | null
}

interface AlertRulesSectionProps {
  open: boolean
}

export function AlertRulesSection({ open }: AlertRulesSectionProps) {
  const [alertRules, setAlertRules] = useState<AlertRule[]>([])
  const [newRuleName, setNewRuleName] = useState('')
  const [newRuleTrigger, setNewRuleTrigger] = useState<AlertRule['trigger_type']>('severity_threshold')
  const [newRuleAction, setNewRuleAction] = useState<AlertRule['action_type']>('webhook_post')
  const [newRuleUrl, setNewRuleUrl] = useState('')
  const [newRuleIntervalHours, setNewRuleIntervalHours] = useState('6')
  const [newRuleSitrepWindow, setNewRuleSitrepWindow] = useState('24')
  const [newRuleCooldown, setNewRuleCooldown] = useState('')
  const [newRuleMaxPerHour, setNewRuleMaxPerHour] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const loadAlertRules = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/alertrules`, { headers: authHeaders() })
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setAlertRules(data)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    if (open) loadAlertRules()
  }, [open, loadAlertRules])

  const createAlertRule = async () => {
    if (!newRuleName.trim()) return
    if (newRuleAction === 'webhook_post' && !newRuleUrl.trim()) return
    if (newRuleAction === 'webhook_post' && !/^https?:\/\//i.test(newRuleUrl.trim())) return
    if (newRuleAction === 'sitrep_delivery' && (!newRuleIntervalHours || parseInt(newRuleIntervalHours, 10) < 1)) return
    const effectiveTrigger = newRuleAction === 'sitrep_delivery' ? 'scheduled' : newRuleTrigger
    try {
      const payload: Record<string, unknown> = {
        name: newRuleName.trim(),
        enabled: true,
        trigger_type: effectiveTrigger,
        rule_filter: effectiveTrigger === 'severity_threshold' ? { min_severity: 'high' } : {},
        action_type: newRuleAction,
        action_config: newRuleAction === 'webhook_post'
          ? { url: newRuleUrl.trim() }
          : newRuleAction === 'sitrep_delivery'
          ? {
              interval_hours: parseInt(newRuleIntervalHours, 10),
              hours_window: parseInt(newRuleSitrepWindow, 10) || 24,
              ...(newRuleUrl.trim() ? { url: newRuleUrl.trim() } : {}),
            }
          : {},
      }
      const cooldownVal = parseInt(newRuleCooldown, 10)
      if (!isNaN(cooldownVal) && cooldownVal > 0) payload.cooldown_seconds = cooldownVal
      const maxVal = parseInt(newRuleMaxPerHour, 10)
      if (!isNaN(maxVal) && maxVal > 0) payload.max_per_hour = maxVal

      const res = await fetch(`${API_BASE}/alertrules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return
      setNewRuleName('')
      setNewRuleUrl('')
      setNewRuleIntervalHours('6')
      setNewRuleSitrepWindow('24')
      setNewRuleCooldown('')
      setNewRuleMaxPerHour('')
      setShowAdvanced(false)
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

  return (
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
          {newRuleAction !== 'sitrep_delivery' && (
            <select
              value={newRuleTrigger}
              onChange={(e) => setNewRuleTrigger(e.target.value as AlertRule['trigger_type'])}
              className="bg-onyx-deep border border-white/10 text-on-surface text-[11px] px-2 py-1.5 focus:outline-none"
            >
              <option value="severity_threshold">Severity</option>
              <option value="geofence_entry">Geofence Entry</option>
              <option value="entity_type">Entity Type</option>
            </select>
          )}
          <select
            value={newRuleAction}
            onChange={(e) => setNewRuleAction(e.target.value as AlertRule['action_type'])}
            className={`bg-onyx-deep border border-white/10 text-on-surface text-[11px] px-2 py-1.5 focus:outline-none ${newRuleAction === 'sitrep_delivery' ? 'col-span-2' : ''}`}
          >
            <option value="webhook_post">Webhook</option>
            <option value="log">Log Only</option>
            <option value="sitrep_delivery">Scheduled SitRep</option>
          </select>
        </div>
        {(newRuleAction === 'webhook_post' || newRuleAction === 'sitrep_delivery') && (
          <input
            type="url"
            placeholder={newRuleAction === 'sitrep_delivery' ? 'Delivery webhook URL (optional)' : 'Webhook URL'}
            value={newRuleUrl}
            onChange={(e) => setNewRuleUrl(e.target.value)}
            className="w-full bg-onyx-deep border border-white/10 text-on-surface placeholder-on-surface-variant text-[11px] px-3 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
          />
        )}
        {newRuleAction === 'sitrep_delivery' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label-caps text-[11px] block mb-1">Interval (hours)</label>
              <input
                type="number"
                min="1"
                max="168"
                value={newRuleIntervalHours}
                onChange={(e) => setNewRuleIntervalHours(e.target.value)}
                className="w-full bg-onyx-deep border border-white/10 text-on-surface text-[11px] px-2 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
              />
            </div>
            <div>
              <label className="label-caps text-[11px] block mb-1">Window (hours)</label>
              <input
                type="number"
                min="1"
                max="168"
                value={newRuleSitrepWindow}
                onChange={(e) => setNewRuleSitrepWindow(e.target.value)}
                className="w-full bg-onyx-deep border border-white/10 text-on-surface text-[11px] px-2 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
              />
            </div>
          </div>
        )}

        {/* Advanced suppression controls */}
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[11px] text-on-surface-variant hover:text-amber-gold uppercase tracking-widest transition-colors focus:outline-none flex items-center gap-1"
        >
          <span className="ms text-[12px] leading-none">{showAdvanced ? 'expand_less' : 'expand_more'}</span>
          Suppression settings
        </button>
        {showAdvanced && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label-caps text-[11px] block mb-1">Cooldown (sec)</label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={newRuleCooldown}
                onChange={(e) => setNewRuleCooldown(e.target.value)}
                className="w-full bg-onyx-deep border border-white/10 text-on-surface text-[11px] px-2 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
              />
            </div>
            <div>
              <label className="label-caps text-[11px] block mb-1">Max / hr</label>
              <input
                type="number"
                min="0"
                placeholder="∞"
                value={newRuleMaxPerHour}
                onChange={(e) => setNewRuleMaxPerHour(e.target.value)}
                className="w-full bg-onyx-deep border border-white/10 text-on-surface text-[11px] px-2 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
              />
            </div>
          </div>
        )}

        <button
          onClick={createAlertRule}
          className="w-full py-1.5 text-[11px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 transition-colors focus:outline-none"
        >
          Add Rule
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {alertRules.length === 0 ? (
          <p className="text-[11px] text-on-surface-variant">No alert rules configured.</p>
        ) : (
          alertRules.map((rule) => (
            <div key={rule.id} className="border border-white/10 bg-onyx-black/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-on-surface font-bold truncate">{rule.name}</span>
                <button
                  onClick={() => toggleAlertRule(rule.id, rule.enabled)}
                  className={`text-[11px] uppercase tracking-widest border px-1.5 py-0.5 ${rule.enabled ? 'text-green-ais border-green-ais/40' : 'text-on-surface-variant border-white/20'}`}
                >
                  {rule.enabled ? 'On' : 'Off'}
                </button>
              </div>
              <div className="text-[11px] text-on-surface-variant uppercase tracking-widest mt-1">
                {rule.action_type !== 'sitrep_delivery' && <span>{rule.trigger_type.replace(/_/g, ' ')} · </span>}
                {rule.action_type.replace(/_/g, ' ')}
                {rule.action_type === 'sitrep_delivery' && rule.action_config.interval_hours != null && (
                  <span className="ml-1 text-amber-gold-dim">· every {String(rule.action_config.interval_hours as number)}h</span>
                )}
                {rule.cooldown_seconds != null && rule.cooldown_seconds > 0 && (
                  <span className="ml-1 text-amber-gold-dim">· cd {rule.cooldown_seconds}s</span>
                )}
                {rule.max_per_hour != null && rule.max_per_hour > 0 && (
                  <span className="ml-1 text-amber-gold-dim">· max {rule.max_per_hour}/hr</span>
                )}
              </div>
              <button
                onClick={() => deleteAlertRule(rule.id)}
                className="mt-1 text-[11px] text-red-emergency hover:text-red-emergency/80 uppercase tracking-widest"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
