import { useEffect, useRef } from 'react'
import { useCivicStore } from '../store'
import { API_BASE } from '../config'
import { authHeaders, isLoggedIn } from '../auth'

const PREF_KEY = 'ui'
const DEBOUNCE_MS = 1500

type UiPrefs = {
  activeTab: string
  mode: string
  trailsVisible: boolean
  radarVisible: boolean
  radarOpacity: number
  smokeVisible: boolean
  camerasVisible: boolean
  geofencesVisible: boolean
  annotationsVisible: boolean
  lightningVisible: boolean
  gaugesVisible: boolean
  terrainEnabled: boolean
  terrainExaggeration: number
  ldiMode: boolean
}

function extractPrefs(s: ReturnType<typeof useCivicStore.getState>): UiPrefs {
  return {
    activeTab:          s.activeTab,
    mode:               s.mode,
    trailsVisible:      s.trailsVisible,
    radarVisible:       s.radarVisible,
    radarOpacity:       s.radarOpacity,
    smokeVisible:       s.smokeVisible,
    camerasVisible:     s.camerasVisible,
    geofencesVisible:   s.geofencesVisible,
    annotationsVisible: s.annotationsVisible,
    lightningVisible:   s.lightningVisible,
    gaugesVisible:      s.gaugesVisible,
    terrainEnabled:     s.terrainEnabled,
    terrainExaggeration: s.terrainExaggeration,
    ldiMode:            s.ldiMode,
  }
}

async function loadAndApply() {
  if (!isLoggedIn()) return
  try {
    const res = await fetch(`${API_BASE}/auth/preferences`, { headers: authHeaders() })
    if (!res.ok) return
    const data: Record<string, unknown> = await res.json()
    const prefs = data[PREF_KEY]
    if (!prefs || typeof prefs !== 'object') return
    const p = prefs as Partial<UiPrefs>
    const store = useCivicStore.getState()
    if (p.activeTab != null)          store.setActiveTab(p.activeTab as Parameters<typeof store.setActiveTab>[0])
    if (p.mode != null)               store.setMode(p.mode as Parameters<typeof store.setMode>[0])
    if (p.trailsVisible != null)      store.setTrailsVisible(p.trailsVisible)
    if (p.radarVisible != null)       store.setRadarVisible(p.radarVisible)
    if (p.radarOpacity != null)       store.setRadarOpacity(p.radarOpacity)
    if (p.smokeVisible != null)       store.setSmokeVisible(p.smokeVisible)
    if (p.camerasVisible != null)     store.setCamerasVisible(p.camerasVisible)
    if (p.geofencesVisible != null)   store.setGeofencesVisible(p.geofencesVisible)
    if (p.annotationsVisible != null) store.setAnnotationsVisible(p.annotationsVisible)
    if (p.lightningVisible != null)   store.setLightningVisible(p.lightningVisible)
    if (p.gaugesVisible != null)      store.setGaugesVisible(p.gaugesVisible)
    if (p.terrainEnabled != null)     store.setTerrainEnabled(p.terrainEnabled)
    if (p.terrainExaggeration != null) store.setTerrainExaggeration(p.terrainExaggeration)
    if (p.ldiMode != null)            store.setLdiMode(p.ldiMode)
  } catch { /* non-fatal */ }
}

async function savePrefs(prefs: UiPrefs) {
  if (!isLoggedIn()) return
  try {
    await fetch(`${API_BASE}/auth/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ [PREF_KEY]: prefs }),
    })
  } catch { /* non-fatal */ }
}

export function usePreferences() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef<string>('')

  // Load preferences from backend on mount
  useEffect(() => {
    loadAndApply()
  }, [])

  // Debounced save whenever persisted state changes
  useEffect(() => {
    const unsub = useCivicStore.subscribe((state) => {
      if (!isLoggedIn()) return
      const prefs = extractPrefs(state)
      const json = JSON.stringify(prefs)
      if (json === lastSavedRef.current) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        lastSavedRef.current = json
        savePrefs(prefs)
      }, DEBOUNCE_MS)
    })
    return () => {
      unsub()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])
}
