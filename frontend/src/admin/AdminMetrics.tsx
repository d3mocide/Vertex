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
  EntityActivityData,
  OverviewData,
  EventActivityData,
  SquawkAlertData,
  TalkgroupActivityData,
  DataQualityData,
} from './metrics/types'
import { AttentionBanner } from './metrics/AttentionBanner'
import { ServiceCards } from './metrics/ServiceCards'
import { FeedTable } from './metrics/FeedTable'
import { LivePerformance } from './metrics/LivePerformance'
import { PollerSummary } from './metrics/PollerSummary'
import { IngestByType } from './metrics/IngestByType'
import { StorageBreakdown } from './metrics/StorageBreakdown'
import { EventActivity } from './metrics/EventActivity'
import { StoragePanel } from './metrics/StoragePanel'
import { DbPoolPanel } from './metrics/DbPoolPanel'
import { SignalQualityChart } from './metrics/SignalQualityChart'
import { EntityActivity } from './metrics/EntityActivity'
import { SquawkCounter } from './metrics/SquawkCounter'
import { TalkgroupActivity } from './metrics/TalkgroupActivity'
import { DataQualityCard } from './metrics/DataQualityCard'
import { DataQualitySummary } from './metrics/DataQualitySummary'
import { StorageSummary } from './metrics/StorageSummary'

type TabName = 'system' | 'ingestion' | 'quality' | 'storage' | 'events'

const TABS: { label: string; value: TabName; icon: string }[] = [
  { label: 'System', value: 'system', icon: 'favorite' },
  { label: 'Ingest', value: 'ingestion', icon: 'cloud_download' },
  { label: 'Quality', value: 'quality', icon: 'analytics' },
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
  const [entityActivity, setEntityActivity] = useState<EntityActivityData | null>(null)
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [eventActivity, setEventActivity] = useState<EventActivityData | null>(null)
  const [squawkAlerts, setSquawkAlerts] = useState<SquawkAlertData | null>(null)
  const [talkgroupActivity, setTalkgroupActivity] = useState<TalkgroupActivityData | null>(null)
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

  const loadEntityActivity = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/entity-activity`, { headers: authHeaders() })
      if (res.ok) setEntityActivity(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  const loadEventActivity = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/event-activity`, { headers: authHeaders() })
      if (res.ok) setEventActivity(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/overview`, { headers: authHeaders() })
      if (res.ok) setOverview(await res.json())
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

  const loadDataQuality = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/data-quality`, { headers: authHeaders() })
      if (res.ok) setDataQuality(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    loadMetrics(); loadOverview(); loadStorage(); loadPollers(); loadIngestion(); loadDbPool()
    loadSignalQuality(); loadEntityActivity(); loadEventActivity()
    loadSquawkAlerts(); loadTalkgroupActivity(); loadDataQuality()

    const fast = setInterval(() => { loadMetrics(); loadPollers(); loadOverview() }, 15_000)
    const slow = setInterval(() => {
      loadStorage(); loadIngestion(); loadDbPool()
      loadSignalQuality(); loadEntityActivity(); loadEventActivity()
      loadSquawkAlerts(); loadTalkgroupActivity(); loadDataQuality()
    }, 60_000)
    return () => { clearInterval(fast); clearInterval(slow) }
  }, [
    loadMetrics, loadOverview, loadStorage, loadPollers, loadIngestion, loadDbPool,
    loadSignalQuality, loadEntityActivity, loadEventActivity,
    loadSquawkAlerts, loadTalkgroupActivity, loadDataQuality,
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

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="grid grid-cols-5 md:flex md:gap-1 border border-white/10 md:border-0 md:border-b bg-surface-container-low md:bg-transparent" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={currentTab === tab.value}
            onClick={() => setCurrentTab(tab.value)}
            className={`flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 px-1 md:px-4 py-2 md:py-3 border-b-2 transition-colors text-[10px] md:text-[11px] font-bold uppercase tracking-wider md:tracking-widest whitespace-nowrap ${
              currentTab === tab.value
                ? 'border-amber-gold text-amber-gold bg-amber-gold/5 md:bg-transparent'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="ms text-[18px] md:text-[16px]" aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="max-w-5xl space-y-8">
        {/* System Health Tab */}
        {currentTab === 'system' && (
          <>
            <AttentionBanner overview={overview} onGoto={setCurrentTab} />

            <section>
              <h2 className="label-caps mb-3">Services</h2>
              <ServiceCards overview={overview} />
            </section>

            <FeedTable feeds={overview?.feeds ?? []} />

            <LivePerformance metrics={metrics} />
          </>
        )}

        {/* Data Ingestion Tab */}
        {currentTab === 'ingestion' && (
          <>
            <IngestByType buckets={ingestion} />

            <PollerSummary pollers={pollers} />
          </>
        )}

        {/* Data Quality Tab */}
        {currentTab === 'quality' && (
          <>
            <DataQualitySummary activity={entityActivity} />

            <EntityActivity data={entityActivity} />

            <DataQualityCard data={dataQuality} />

            <SignalQualityChart data={signalQuality} />
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

            <StorageBreakdown storage={storage} />

            <DbPoolPanel pool={dbPool} />
          </>
        )}

        {/* Events Tab */}
        {currentTab === 'events' && (
          <>
            <SquawkCounter data={squawkAlerts} />

            <EventActivity data={eventActivity} />

            <TalkgroupActivity data={talkgroupActivity} />
          </>
        )}
      </div>
    </div>
  )
}
