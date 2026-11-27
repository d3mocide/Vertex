import { useEffect, useMemo, useState } from 'react'
import { useCivicPick } from '../../../store'
import type {
  Entity,
  MeshMessage,
  RadioIncident,
  SummaryPosture,
  Track,
  TrafficIncident,
  WeatherAlert,
} from '../../../storeTypes'
import { ALERT_LABEL, ROLE_ORDER, roleMeta, type AircraftRole } from '../../../aircraftRoles'
import { isActive } from '../RadioIncidents'
import { isMajorTrafficIncident } from '../../../incidentUtils'
import { getDistanceMeters } from '../../../layers/geoUtils'
import { API_BASE, DEFAULT_CENTER } from '../../../config'
import { authHeaders } from '../../../auth'

export interface P25CallSnippet {
  id: number
  tgid: number
  tag: string | null
  started_at: string
  duration_s: number | null
  transcription: string | null
}

export interface NotableAirItem {
  id: string
  callsign: string
  role: AircraftRole | null
  roleLabel: string | null
  alert: string | null
  alertLabel: string | null
  military: boolean
  tagged: boolean
  fallbackNearby: boolean
  altFt: number | null
  speedKt: number | null
  distKm: number | null
  model: string | null
  lat: number | null
  lon: number | null
}

export interface NotableVesselItem {
  id: string
  name: string
  shipType: string | null
  navStatus: string | null
  underway: boolean
  priorityVessel: boolean
  speedKt: number | null
  heading: number | null
  distKm: number | null
  lat: number | null
  lon: number | null
}

export interface DashboardMeshItem {
  key: string
  sender: string
  channel: string
  text: string
  timestamp: string
  snr: number | null
}

export interface MetarSummary {
  icao: string
  flightCategory: string
}

const PRIORITY_VESSEL_RE = /(coast guard|patrol|law|police|rescue|sar|pilot|tug|military|navy|fire|medical|dredg|tanker|hazmat)/i

export function formatRelativeAge(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return ''
  const sec = Math.max(0, Math.floor((nowMs - ts) / 1000))
  if (sec < 60) return 'now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

export function extractBriefingLead(markdown: string | null | undefined): string {
  if (!markdown) return ''
  const intro = markdown.split(/^#{2,3}\s+/m)[0]?.trim() ?? ''
  return intro
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function prettyChannelLabel(conversationKey: string, channelName?: string): string {
  const raw = (channelName || conversationKey || 'public').trim()
  if (!raw) return 'PUBLIC'
  if (/^(public|general)$/i.test(raw)) return 'PUBLIC'
  if (/^[a-f0-9]{12,}$/i.test(raw)) return `CH ${raw.slice(0, 6).toUpperCase()}`
  return raw.toUpperCase()
}

function calcDistKm(lat: number | undefined | null, lon: number | undefined | null, existing?: number): number | null {
  if (typeof existing === 'number' && Number.isFinite(existing)) return existing
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  const [centerLon, centerLat] = DEFAULT_CENTER
  return getDistanceMeters(centerLat, centerLon, lat, lon) / 1000
}

function rolePriority(role: AircraftRole | null): number {
  if (!role) return 99
  const idx = ROLE_ORDER.indexOf(role)
  return idx >= 0 ? idx : 99
}

function readStringField(identity: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  if (!identity) return null
  for (const k of keys) {
    const v = identity[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

/**
 * Lightweight recent P25 call recordings poller for Dashboard, Wall Display,
 * and Phone Glance. Runs only while `enabled` is true (8 latest rows, 15s cadence).
 */
export function useRecentP25Calls(enabled: boolean): P25CallSnippet[] {
  const [calls, setCalls] = useState<P25CallSnippet[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/radio/recordings?hours=6&limit=8`, { headers: authHeaders() })
        if (!res.ok) return
        const data = (await res.json()) as P25CallSnippet[]
        if (!cancelled && Array.isArray(data)) setCalls(data)
      } catch {
        // Keep last known call snippets on transient errors.
      }
    }
    void load()
    const timer = setInterval(() => void load(), 15_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled])

  return calls
}

/**
 * Optional nearest-airport METAR flight category badge for Weather & Hazards.
 * Polls slowly (5 min) only while mounted; fails silently if unavailable.
 */
export function useNearestMetar(enabled: boolean): MetarSummary | null {
  const [metar, setMetar] = useState<MetarSummary | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/weather/aviation/obs`, { headers: authHeaders() })
        if (!res.ok) return
        const raw = (await res.json()) as unknown
        const list = Array.isArray(raw)
          ? raw
          : (raw && typeof raw === 'object' && Array.isArray((raw as { stations?: unknown[] }).stations))
            ? (raw as { stations: unknown[] }).stations
            : []
        for (const item of list) {
          if (!item || typeof item !== 'object') continue
          const rec = item as Record<string, unknown>
          const icao = typeof rec.icao === 'string'
            ? rec.icao
            : typeof rec.station === 'string'
              ? rec.station
              : typeof rec.icaoId === 'string'
                ? rec.icaoId
                : null
          const cat = typeof rec.flight_category === 'string'
            ? rec.flight_category
            : typeof rec.fltCat === 'string'
              ? rec.fltCat
              : null
          if (icao && cat) {
            if (!cancelled) setMetar({ icao: icao.toUpperCase(), flightCategory: cat.toUpperCase() })
            return
          }
        }
      } catch {
        // Optional badge; ignore errors.
      }
    }
    void load()
    const timer = setInterval(() => void load(), 300_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled])

  return metar
}

export function useDashboardData() {
  const {
    entities,
    tracks,
    advisories,
    radioIncidents,
    trafficIncidents,
    weather,
    summary,
    radio,
    meshMessages,
    meshLinks,
    lightningStrikes,
    entityMissionTags,
    connected,
    health,
  } = useCivicPick(
    'entities',
    'tracks',
    'advisories',
    'radioIncidents',
    'trafficIncidents',
    'weather',
    'summary',
    'radio',
    'meshMessages',
    'meshLinks',
    'lightningStrikes',
    'entityMissionTags',
    'connected',
    'health',
  )

  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // ── Posture ────────────────────────────────────────────────────────────────
  const posture: SummaryPosture = useMemo(() => {
    if (summary.posture) return summary.posture
    if (advisories?.level === 'red') return 'HIGH'
    if (advisories?.level === 'amber') return 'ELEVATED'
    return 'NORMAL'
  }, [summary.posture, advisories?.level])

  const briefingLead = useMemo(() => extractBriefingLead(summary.summary), [summary.summary])

  // ── Active Incidents (Dispatch + NWS + Major Traffic) ──────────────────────
  const activeDispatch: RadioIncident[] = useMemo(() => {
    const list = radioIncidents?.incidents ?? []
    return list
      .filter((i) => isActive(i, nowMs) && i.severity >= 3)
      .sort((a, b) => b.severity - a.severity || Date.parse(b.last_seen) - Date.parse(a.last_seen))
  }, [radioIncidents, nowMs])

  const weatherAlerts: WeatherAlert[] = weather.alerts ?? []

  const majorTraffic: TrafficIncident[] = useMemo(
    () => trafficIncidents.filter(isMajorTrafficIncident),
    [trafficIncidents],
  )

  const totalActiveIncidents = activeDispatch.length + weatherAlerts.length + majorTraffic.length
  const isQuiet = totalActiveIncidents === 0 && posture === 'NORMAL' && (advisories?.count ?? 0) === 0

  // ── Air & Sea Notable Watch ────────────────────────────────────────────────
  const {
    notableAir,
    notableVessels,
    totalAircraft,
    totalVessels,
    meshNodeCount,
    fireHazardCount,
  } = useMemo(() => {
    const entityList: Entity[] = Object.values(entities)
    let airCount = 0
    let seaCount = 0
    let meshCount = 0
    let fireCount = 0

    const flaggedAir: NotableAirItem[] = []
    const fallbackAir: NotableAirItem[] = []
    const vesselList: NotableVesselItem[] = []

    for (const e of entityList) {
      if (e.entity_type === 'mesh_node') {
        meshCount++
        continue
      }
      if (e.entity_type === 'fire_incident') {
        fireCount++
        continue
      }

      if (e.entity_type === 'aircraft') {
        airCount++
        const tr: Track | undefined = tracks[e.entity_id]
        const idObj = e.identity
        const roleRaw = tr?.role ?? (typeof idObj?.role === 'string' ? idObj.role : null)
        const rm = roleMeta(roleRaw)
        const role = rm ? (roleRaw as AircraftRole) : null
        const alertKey = tr?.alert ?? (typeof idObj?.alert === 'string' ? idObj.alert : null)
        const alertLabel = alertKey ? (ALERT_LABEL[alertKey] ?? alertKey.toUpperCase()) : null
        const military = Boolean(tr?.military || idObj?.military === true)
        const tagged = (entityMissionTags[e.entity_id]?.length ?? 0) > 0
        const lat = tr?.lat ?? e.lat ?? null
        const lon = tr?.lon ?? e.lon ?? null
        const distKm = calcDistKm(lat, lon, e.distance_km)
        const altFt = tr?.altMeters != null
          ? Math.round(tr.altMeters * 3.28084)
          : e.altitude != null
            ? Math.round(e.altitude)
            : null
        const speedKt = tr?.speedMs != null
          ? Math.round(tr.speedMs * 1.94384)
          : e.speed != null
            ? Math.round(e.speed)
            : null
        const callsign = (tr?.callsign || e.display_name || e.entity_id.split(':').pop() || 'AIRCRAFT').trim().toUpperCase()
        const model = readStringField(idObj, 'type_desc', 'aircraft_type', 'type', 'icao_type', 'operator')

        const item: NotableAirItem = {
          id: e.entity_id,
          callsign,
          role,
          roleLabel: rm?.short ?? (military ? 'MIL' : null),
          alert: alertKey,
          alertLabel,
          military,
          tagged,
          fallbackNearby: false,
          altFt,
          speedKt,
          distKm,
          model,
          lat,
          lon,
        }

        if (alertKey || role || military || tagged) {
          flaggedAir.push(item)
        } else {
          fallbackAir.push({ ...item, fallbackNearby: true })
        }
        continue
      }

      if (e.entity_type === 'vessel') {
        seaCount++
        const tr: Track | undefined = tracks[e.entity_id]
        const idObj = e.identity
        const lat = tr?.lat ?? e.lat ?? null
        const lon = tr?.lon ?? e.lon ?? null
        const distKm = calcDistKm(lat, lon, e.distance_km)
        const speedKt = tr?.speedMs != null
          ? Number((tr.speedMs * 1.94384).toFixed(1))
          : e.speed != null
            ? Number(e.speed.toFixed(1))
            : null
        const shipType = tr?.shipType ?? readStringField(idObj, 'ship_type_name', 'ship_type', 'vessel_type')
        const navStatus = readStringField(idObj, 'navigational_status', 'nav_status')
        const name = (tr?.callsign || e.display_name || e.entity_id.split(':').pop() || 'VESSEL').trim().toUpperCase()
        const underway = (speedKt != null && speedKt >= 0.5) || Boolean(navStatus && /underway/i.test(navStatus))
        const priorityVessel = Boolean(
          (shipType && PRIORITY_VESSEL_RE.test(shipType)) ||
          PRIORITY_VESSEL_RE.test(name) ||
          (entityMissionTags[e.entity_id]?.length ?? 0) > 0,
        )

        vesselList.push({
          id: e.entity_id,
          name,
          shipType,
          navStatus,
          underway,
          priorityVessel,
          speedKt,
          heading: tr?.courseTrue ?? e.heading ?? null,
          distKm,
          lat,
          lon,
        })
      }
    }

    flaggedAir.sort((a, b) =>
      Number(Boolean(b.alert)) - Number(Boolean(a.alert)) ||
      rolePriority(a.role) - rolePriority(b.role) ||
      Number(b.tagged) - Number(a.tagged) ||
      (a.distKm ?? Infinity) - (b.distKm ?? Infinity),
    )

    fallbackAir.sort((a, b) => (a.distKm ?? Infinity) - (b.distKm ?? Infinity))

    vesselList.sort((a, b) =>
      Number(b.priorityVessel) - Number(a.priorityVessel) ||
      Number(b.underway) - Number(a.underway) ||
      (a.distKm ?? Infinity) - (b.distKm ?? Infinity),
    )

    return {
      notableAir: flaggedAir.length > 0 ? flaggedAir : fallbackAir.slice(0, 2),
      notableVessels: vesselList,
      totalAircraft: airCount,
      totalVessels: seaCount,
      meshNodeCount: meshCount,
      fireHazardCount: fireCount,
    }
  }, [entities, tracks, entityMissionTags])

  // ── MeshCore Latest Feed ───────────────────────────────────────────────────
  const latestMesh: DashboardMeshItem[] = useMemo(() => {
    const snrByNode = new Map<string, number>()
    for (const link of meshLinks) {
      if (link.snr == null) continue
      const prevA = snrByNode.get(link.node_a)
      if (prevA == null || link.snr > prevA) snrByNode.set(link.node_a, link.snr)
      const prevB = snrByNode.get(link.node_b)
      if (prevB == null || link.snr > prevB) snrByNode.set(link.node_b, link.snr)
    }

    const sorted: MeshMessage[] = [...meshMessages].sort(
      (a, b) => Date.parse(b.timestamp || '') - Date.parse(a.timestamp || ''),
    )

    return sorted.slice(0, 12).map((m, idx) => ({
      key: m.id || `${m.timestamp}-${m.sender_key}-${idx}`,
      sender: (m.sender_name || m.sender_key?.slice(0, 8) || 'NODE').trim(),
      channel: prettyChannelLabel(m.conversation_key, m.channel_name),
      text: m.text,
      timestamp: m.timestamp,
      snr: snrByNode.get(m.sender_key) ?? snrByNode.get(m.sender_name) ?? null,
    }))
  }, [meshMessages, meshLinks])

  return {
    nowMs,
    connected,
    health,
    posture,
    summary,
    briefingLead,
    advisories,
    activeDispatch,
    weatherAlerts,
    majorTraffic,
    totalActiveIncidents,
    isQuiet,
    notableAir,
    notableVessels,
    totalAircraft,
    totalVessels,
    meshNodeCount,
    fireHazardCount,
    weather,
    lightningCount: lightningStrikes.length,
    radio,
    latestMesh,
  }
}
