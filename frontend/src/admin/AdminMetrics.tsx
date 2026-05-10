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
import { WsClientChart } from './metrics/WsClientChart'

export default function AdminMetrics() {
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
    <div className="space-y-8 max-w-5xl">
      {/* 1. System Health Bar */}
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">System Health</h2>
        <HealthBar
          metrics={metrics}
          dbPingMs={metrics?.db_ping_ms ?? -1}
          redisPingMs={metrics?.redis_ping_ms ?? -1}
          pollerOkCount={pollerOkCount}
          pollerTotal={pollers.length}
        />
      </section>

      {/* 2. Live Performance */}
      <LivePerformance metrics={metrics} />

      {/* 3. WebSocket Client Timeline */}
      <WsClientChart history={metrics?.history ?? []} />

      {/* 4. Poller Grid */}
      <PollerGrid pollers={pollers} />

      {/* 5. Ingestion Chart */}
      <IngestionChart buckets={ingestion} />

      {/* 6. Entity Donut */}
      <EntityDonut storage={storage} />

      {/* 7. Event Activity */}
      <EventActivity storage={storage} />

      {/* 8. Entity Freshness */}
      <EntityFreshness data={entityFreshness} />

      {/* 9. Signal Quality */}
      <SignalQualityChart data={signalQuality} />

      {/* 10. Emergency Squawk Counter */}
      <SquawkCounter data={squawkAlerts} />

      {/* 11. P25 Talkgroup Activity */}
      <TalkgroupActivity data={talkgroupActivity} />

      {/* 12. Mesh Node Battery */}
      <MeshBatteryChart data={meshBattery} />

      {/* 13. Data Completeness Scorecard */}
      <DataQualityCard data={dataQuality} />

      {/* 14. Storage + Retention */}
      <StoragePanel
        storage={storage}
        retentionDays={retentionDays}
        setRetentionDays={setRetentionDays}
        onSave={saveRetention}
        saving={retentionSaving}
        saved={retentionSaved}
      />

      {/* 15. DB Connection Pool */}
      <DbPoolPanel pool={dbPool} />
    </div>
  )
}
