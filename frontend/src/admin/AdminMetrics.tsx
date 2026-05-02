import React, { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

import type { MetricsData, StorageData, PollerEntry, IngestionBucket, DbPoolData } from './metrics/types'
import { HealthBar } from './metrics/HealthBar'
import { LivePerformance } from './metrics/LivePerformance'
import { PollerGrid } from './metrics/PollerGrid'
import { IngestionChart } from './metrics/IngestionChart'
import { EntityDonut } from './metrics/EntityDonut'
import { EventActivity } from './metrics/EventActivity'
import { StoragePanel } from './metrics/StoragePanel'
import { DbPoolPanel } from './metrics/DbPoolPanel'

export default function AdminMetrics() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [storage, setStorage] = useState<StorageData | null>(null)
  const [pollers, setPollers] = useState<PollerEntry[]>([])
  const [ingestion, setIngestion] = useState<IngestionBucket[]>([])
  const [dbPool, setDbPool] = useState<DbPoolData | null>(null)
  const [retentionDays, setRetentionDays] = useState(30)
  const [retentionSaving, setRetentionSaving] = useState(false)
  const [retentionSaved, setRetentionSaved] = useState(false)

  const h = authHeaders()

  const loadMetrics = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/metrics`, { headers: h })
      if (res.ok) setMetrics(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  const loadStorage = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/storage`, { headers: h })
      if (res.ok) {
        const data: StorageData = await res.json()
        setStorage(data)
        setRetentionDays(data.retention_days)
      }
    } catch { /* non-fatal */ }
  }, [])

  const loadPollers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/pollers`, { headers: h })
      if (res.ok) {
        const data = await res.json()
        setPollers(data.pollers ?? [])
      }
    } catch { /* non-fatal */ }
  }, [])

  const loadIngestion = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/ingestion-rate?window_minutes=60`, { headers: h })
      if (res.ok) {
        const data = await res.json()
        setIngestion(data.buckets ?? [])
      }
    } catch { /* non-fatal */ }
  }, [])

  const loadDbPool = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/db-pool`, { headers: h })
      if (res.ok) setDbPool(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    // Initial loads
    loadMetrics(); loadStorage(); loadPollers(); loadIngestion(); loadDbPool()

    // Fast refresh — metrics + pollers every 15s
    const fast = setInterval(() => { loadMetrics(); loadPollers() }, 15_000)
    // Slow refresh — storage, ingestion, db pool every 60s
    const slow = setInterval(() => { loadStorage(); loadIngestion(); loadDbPool() }, 60_000)
    return () => { clearInterval(fast); clearInterval(slow) }
  }, [loadMetrics, loadStorage, loadPollers, loadIngestion, loadDbPool])

  const saveRetention = async () => {
    setRetentionSaving(true)
    try {
      await fetch(`${API_BASE}/admin/retention`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
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

      {/* 3. Poller Grid + 4. Ingestion Chart — side by side on wide screens */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <PollerGrid pollers={pollers} />
        <IngestionChart buckets={ingestion} />
      </div>

      {/* 5. Entity Donut */}
      <EntityDonut storage={storage} />

      {/* 6. Event Activity */}
      <EventActivity storage={storage} />

      {/* 7. Storage + Retention */}
      <StoragePanel
        storage={storage}
        retentionDays={retentionDays}
        setRetentionDays={setRetentionDays}
        onSave={saveRetention}
        saving={retentionSaving}
        saved={retentionSaved}
      />

      {/* 8. DB Connection Pool */}
      <DbPoolPanel pool={dbPool} />
    </div>
  )
}
