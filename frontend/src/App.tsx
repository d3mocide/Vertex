import { useState, useEffect } from 'react'
import { useCivicStore } from './store'
import { useAlerts } from './hooks/useAlerts'
import { useSystemHealth } from './hooks/useSystemHealth'
import { useTrailHydration } from './hooks/useTrailHydration'
import { usePreferences } from './hooks/usePreferences'
import { useMeshHistory } from './hooks/useMeshHistory'
import { LoginPage } from './components/LoginPage'
import { isLoggedIn } from './auth'
import { API_BASE } from './config'

import { AlertStatusBar }    from './components/layout/AlertStatusBar'
import { Sidebar }           from './components/layout/Sidebar'
import { Header }            from './components/layout/Header'
import { EnvBar }            from './components/layout/EnvBar'
import { MobileNav }         from './components/layout/MobileNav'
import { SettingsPanel }     from './components/layout/SettingsPanel'
import { HelpPanel }         from './components/panels/HelpPanel'
import { Map }               from './components/Map'
import { TacticalAudio }     from './components/panels/TacticalAudio'
import { EntityDetail }      from './components/panels/EntityDetail'
import { InfrastructureGrid } from './components/panels/InfrastructureGrid'
import { EnvironmentPanel }  from './components/panels/EnvironmentPanel'
import { IntelPanel }         from './components/panels/IntelPanel'
import { elevateNewsToEvent } from './intelProcessor'
import { EventLogPanel }      from './components/panels/EventLogPanel'
import { EntitySearchPanel }   from './components/panels/EntitySearchPanel'
import { PlaybackController }  from './components/panels/PlaybackController'
import { GeofenceController }  from './components/panels/GeofenceController'
import { CameraModal }         from './components/panels/CameraModal'
import { IncidentsPanel }      from './components/panels/IncidentsPanel'
import { CommsPanel }          from './components/panels/CommsPanel'
import { FlightLogPanel }      from './components/panels/FlightLogPanel'
import { AnnotationController } from './components/panels/AnnotationController'
import { InstallPrompt } from './components/InstallPrompt'

// ── Authenticated dashboard ────────────────────────────────────────────────────
function Dashboard() {
  useAlerts()
  useSystemHealth()
  useTrailHydration()
  usePreferences()
  useMeshHistory()

  const { news, appendSystemEvent } = useCivicStore()

  // Background Intelligence Processor
  // Elevates critical news headlines to system events (Incidents)
  useEffect(() => {
    news.forEach(item => {
      const event = elevateNewsToEvent(item)
      if (event) {
        appendSystemEvent(event)
      }
    })
  }, [news, appendSystemEvent])

  const { activeTab, mode } = useCivicStore()
  const isCritical = mode === 'critical'

  return (
    <div
      className="dark h-screen w-screen overflow-hidden flex flex-col font-body text-sm antialiased bg-onyx-black text-on-surface pb-14 lg:pb-0"
      data-mode={mode}
    >
      {/* Map Background Layer */}
      <div
        className={`
          fixed inset-0 transition-opacity duration-300
          ${activeTab === 'safety' ? 'opacity-100 z-0' : 'opacity-30 z-0'}
        `}
        aria-hidden={activeTab !== 'safety'}
      >
        <Map />
      </div>

      <AlertStatusBar />

      <div className="flex flex-1 min-h-0 relative z-10 pointer-events-none">
        <div className="hidden lg:flex pointer-events-auto h-full shrink-0">
          <Sidebar />
        </div>

        <div className="relative flex-1 min-w-0 overflow-hidden transition-all duration-300 pointer-events-none">
          <div className="absolute top-0 inset-x-0 z-40 pointer-events-none">
            <div className="pointer-events-auto">
              <Header />
              <EnvBar />
            </div>
          </div>

          <div className="absolute inset-0 overflow-hidden pointer-events-none *:pointer-events-auto">

            {activeTab !== 'safety' && (
              <div className="absolute top-24 inset-x-0 bottom-0 z-10 bg-onyx-black/40 backdrop-blur-sm overflow-y-auto">
                {activeTab === 'infrastructure' && <InfrastructureGrid />}
                {activeTab === 'environment'    && <EnvironmentPanel   />}
                {activeTab === 'intel'          && <IntelPanel         />}
                {activeTab === 'events'         && <EventLogPanel      />}
                {activeTab === 'incidents'      && <IncidentsPanel     />}
                {activeTab === 'comms'          && <CommsPanel         />}
                {activeTab === 'flightlog'      && <FlightLogPanel     />}
              </div>
            )}

            <TacticalAudio />

            {activeTab === 'safety' && (
              <>
                <EntitySearchPanel />
                <EntityDetail />
                <div className="absolute top-28 left-2 lg:left-[352px] flex gap-2 z-30 pointer-events-none *:pointer-events-auto">
                  <PlaybackController />
                  <GeofenceController />
                  <AnnotationController />
                </div>
              </>
            )}

            {isCritical && activeTab !== 'safety' && (
              <>
                <EntityDetail />
              </>
            )}

            <CameraModal />
          </div>
        </div>
      </div>

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 btn-primary"
      >
        Skip to main content
      </a>

      <MobileNav />
      <SettingsPanel />
      <HelpPanel />
      <InstallPrompt />
    </div>
  )
}

// ── Auth gate ─────────────────────────────────────────────────────────────────
export default function App() {
  const [authChecked, setAuthChecked]     = useState(false)
  const [authed, setAuthed]               = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/auth/status`)
      .then(r => r.json())
      .then(({ auth_enabled, setup_required }: { auth_enabled: boolean; setup_required: boolean }) => {
        setSetupRequired(setup_required)
        setAuthed(!auth_enabled || (!setup_required && isLoggedIn()))
        setAuthChecked(true)
      })
      .catch(() => {
        setAuthed(false)
        setAuthChecked(true)
      })
  }, [])

  if (!authChecked) return (
    <div className="w-screen h-screen bg-onyx-black flex flex-col items-center justify-center gap-6">
      {/* Scope mark — static corner brackets, rotating diamond, pulsing amber center */}
      <svg width="64" height="64" viewBox="0 0 32 32" aria-hidden="true" className="text-white">
        <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
          <path d="M2 8 V2 H8"/>
          <path d="M24 2 H30 V8"/>
          <path d="M30 24 V30 H24"/>
          <path d="M8 30 H2 V24"/>
        </g>
        <polygon
          points="16,7 25,16 16,25 7,16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            transformOrigin: '16px 16px',
            animation: 'spin 2s linear infinite',
          }}
        />
        <rect
          x="14" y="14" width="4" height="4"
          fill="#FFB800"
          style={{ animation: 'pulse 1.6s ease-in-out infinite' }}
        />
      </svg>
      <div className="flex flex-col items-center gap-1">
        <span className="text-[16px] font-black tracking-[0.05em] text-white uppercase select-none">VERTEX</span>
        <span className="font-mono text-[11px] tracking-[0.2em] text-amber-gold uppercase select-none">SITUATIONAL AWARENESS</span>
      </div>
    </div>
  )
  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} setupRequired={setupRequired} />
  return <Dashboard />
}
