import React, { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

import type {
  MetricsData,
  StorageData,
  PollerEntry,
  IngestionBucket,
  DbPoolData,
  SignalQualityData,
  EntityFreshnessData,
  SquawkAlertData,
  TalkgroupActivityData,
  MeshBatteryData,
  DataQualityData,
} from './metrics/types'
import { HealthBar } from './metrics/HealthBar'
import { LivePerformance } from './metrics/LivePerformance'
import { PollerGrid } from './metrics/PollerGrid'
import { IngestionChart } from './metrics/IngestionChart'
import { EntityDonut } from './metrics/EntityDonut'
import { EventActivity } from './metrics/EventActivity'
import { StoragePanel } from './metrics/StoragePanel'
import { DbPoolPanel } from './metrics/DbPoolPanel'
import { SignalQualityChart } from './metrics/SignalQualityChart'
import { EntityFreshness } from './metrics/EntityFreshness'
import { SquawkCounter } from './metrics/SquawkCounter'
import { TalkgroupActivity } from './metrics/TalkgroupActivity'
import { MeshBatteryChart } from './metrics/MeshBatteryChart'
import { DataQualityCard } from './metrics/DataQualityCard'
import { DataQualitySummary } from './metrics/DataQualitySummary'
import { StorageSummary } from './metrics/StorageSummary'
import { WsClientChart } from './metrics/WsClientChart'

type TabName = 'system' | 'ingestion' | 'quality' | 'storage' | 'events'

const TABS: { label: string; value: TabName; icon: string }[] = [
  { label: 'System Health', value: 'system', icon: 'favorite' },
  { label: 'Data Ingestion', value: 'ingestion', icon: 'cloud_download' },
  { label: 'Data Quality', value: 'quality', icon: 'analytics' },
  { label: 'Storage', value: 'storage', icon: 'storage' },
  { label: 'Events', value: 'events', icon: 'event' },
]

export default function AdminMetrics() {
  const [currentTab, setCurrentTab] = useState<TabName>('system')
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [storage, setStorage] = useState<StorageData | null>(null)
  const [pollers, setPollers] = useState<PollerEntry[]>([])
  const [ingestion, setIngestion] = useState<IngestionBucket[]>([])
  const [dbPool, setDbPool] = useState<DbPoolData | null>(null)
  const [signalQuality, setSignalQuality] = useState<SignalQualityData | null>(null)
  const [entityFreshness, setEntityFreshness] = useState<EntityFreshnessData | null>(null)
  const [squawkAlerts, setSquawkAlerts] = useState<SquawkAlertData | null>(null)
  const [talkgroupActivity, setTalkgroupActivity] = useState<TalkgroupActivityData | null>(null)
  const [meshBattery, setMeshBattery] = useState<MeshBatteryData | null>(null)
  const [dataQuality, setDataQuality] = useState<DataQualityData | null>(null)
  const [retentionDays, setRetentionDays] = useState(30)
  const [retentionSaving, setRetentionSaving] = useState(false)
  const [retentionSaved, setRetentionSaved] = useState(false)

  const loadMetrics = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/metrics`, { headers: authHeaders() })
      if (res.ok) setMetrics(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  const loadStorage = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/storage`, { headers: authHeaders() })
      if (res.ok) {
        const data: StorageData = await res.json()
        setStorage(data)
        setRetentionDays(data.retention_days)
      }
    } catch { /* non-fatal */ }
  }, [])

  const loadPollers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/pollers`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setPollers(data.pollers ?? [])
      }
    } catch { /* non-fatal */ }
  }, [])

  const loadIngestion = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/ingestion-rate?window_minutes=60`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setIngestion(data.buckets ?? [])
      }
    } catch { /* non-fatal */ }
  }, [])

  const loadDbPool = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/db-pool`, { headers: authHeaders() })
      if (res.ok) setDbPool(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  const loadSignalQuality = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/signal-quality?window_minutes=60`, { headers: authHeaders() })
      if (res.ok) setSignalQuality(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  const loadEntityFreshness = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/entity-freshness`, { headers: authHeaders() })
      if (res.ok) setEntityFreshness(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  const loadSquawkAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/squawk-alerts`, { headers: authHeaders() })
      if (res.ok) setSquawkAlerts(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  const loadTalkgroupActivity = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/talkgroup-activity`, { headers: authHeaders() })
      if (res.ok) setTalkgroupActivity(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  const loadMeshBattery = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/mesh-battery`, { headers: authHeaders() })
      if (res.ok) setMeshBattery(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  const loadDataQuality = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/data-quality`, { headers: authHeaders() })
      if (res.ok) setDataQuality(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    loadMetrics(); loadStorage(); loadPollers(); loadIngestion(); loadDbPool()
    loadSignalQuality(); loadEntityFreshness()
    loadSquawkAlerts(); loadTalkgroupActivity(); loadMeshBattery(); loadDataQuality()

    const fast = setInterval(() => { loadMetrics(); loadPollers() }, 15_000)
    const slow = setInterval(() => {
      loadStorage(); loadIngestion(); loadDbPool()
      loadSignalQuality(); loadEntityFreshness()
      loadSquawkAlerts(); loadTalkgroupActivity(); loadMeshBattery(); loadDataQuality()
    }, 60_000)
    return () => { clearInterval(fast); clearInterval(slow) }
  }, [
    loadMetrics, loadStorage, loadPollers, loadIngestion, loadDbPool,
    loadSignalQuality, loadEntityFreshness,
    loadSquawkAlerts, loadTalkgroupActivity, loadMeshBattery, loadDataQuality,
  ])

  const saveRetention = async () => {
    setRetentionSaving(true)
    try {
      await fetch(`${API_BASE}/admin/retention`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ retention_days: retentionDays }),
      })
      setRetentionSaved(true)
      setTimeout(() => setRetentionSaved(false), 2000)
      await loadStorage()
    } catch { /* non-fatal */ } finally {
      setRetentionSaving(false)
    }
  }

  const pollerOkCount = pollers.filter((p) => p.status === 'ok').length

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-white/10 -mx-6 px-6">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setCurrentTab(tab.value)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${
                currentTab === tab.value
                  ? 'border-amber-gold text-amber-gold'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="ms text-[16px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-5xl space-y-8">
        {/* System Health Tab */}
        {currentTab === 'system' && (
          <>
            <section>
              <h2 className="text-[11px] uppercase tracking-widest text-gray-500 mb-3">System Health Bar</h2>
              <HealthBar
                metrics={metrics}
                dbPingMs={metrics?.db_ping_ms ?? -1}
                redisPingMs={metrics?.redis_ping_ms ?? -1}
                pollerOkCount={pollerOkCount}
                pollerTotal={pollers.length}
              />
            </section>

            {/* Overall Health Status */}
            {metrics && metrics.available && (
              <section className="p-4 border border-white/10 bg-surface-container-low">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-1">Status</div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        metrics.error_pct <= 2 && metrics.p95_ms <= 500 ? 'bg-emerald-400' 
                        : metrics.error_pct <= 5 && metrics.p95_ms <= 1000 ? 'bg-amber-400'
                        : 'bg-red-400'
                      }`} />
                      <span className="font-mono text-[11px]">
                        {metrics.error_pct <= 2 && metrics.p95_ms <= 500 ? 'HEALTHY'
                        : metrics.error_pct <= 5 && metrics.p95_ms <= 1000 ? 'DEGRADED'
                        : 'UNHEALTHY'}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-1">Uptime</div>
                    <div className="font-mono text-[11px] text-on-surface">
                      {metrics && 'uptime_seconds' in metrics && metrics.uptime_seconds
                        ? (() => {
                            const h = Math.floor(metrics.uptime_seconds / 3600)
                            const m = Math.floor((metrics.uptime_seconds % 3600) / 60)
                            return h > 0 ? `${h}h ${m}m` : `${m}m`
                          })()
                        : '—'
                      }
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-1">Pollers Stale</div>
                    <div className="font-mono text-[11px]">{pollers.filter((p) => p.status === 'stale').length} of {pollers.length}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-1">Errors</div>
                    <div className={`font-mono text-[11px] ${metrics.error_pct > 5 ? 'text-red-400' : 'text-on-surface'}`}>
                      {metrics.error_pct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </section>
            )}

            <LivePerformance metrics={metrics} />

            <WsClientChart history={metrics?.history ?? []} />
          </>
        )}

        {/* Data Ingestion Tab */}
        {currentTab === 'ingestion' && (
          <>
            <PollerGrid pollers={pollers} />

            <EntityDonut storage={storage} />

            <IngestionChart buckets={ingestion} />
          </>
        )}

        {/* Data Quality Tab */}
        {currentTab === 'quality' && (
          <>
            <DataQualitySummary dataQuality={dataQuality} entityFreshness={entityFreshness} />

            <EntityFreshness data={entityFreshness} />

            <SignalQualityChart data={signalQuality} />

            <DataQualityCard data={dataQuality} />
          </>
        )}

        {/* Storage Tab */}
        {currentTab === 'storage' && (
          <>
            <StorageSummary storage={storage} retentionDays={retentionDays} />

            <StoragePanel
              storage={storage}
              retentionDays={retentionDays}
              setRetentionDays={setRetentionDays}
              onSave={saveRetention}
              saving={retentionSaving}
              saved={retentionSaved}
            />

            <DbPoolPanel pool={dbPool} />
          </>
        )}

        {/* Events Tab */}
        {currentTab === 'events' && (
          <>
            <EventActivity storage={storage} />

            <SquawkCounter data={squawkAlerts} />

            <TalkgroupActivity data={talkgroupActivity} />

            <MeshBatteryChart data={meshBattery} />
          </>
        )}
      </div>
    </div>
  )
}
