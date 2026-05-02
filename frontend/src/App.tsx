import { useState, useEffect } from 'react'
import { useCivicStore } from './store'
import { useAlerts } from './hooks/useAlerts'
import { useSystemHealth } from './hooks/useSystemHealth'
import { LoginPage } from './components/LoginPage'
import { isLoggedIn } from './auth'
import { API_BASE } from './config'

import { AlertStatusBar }    from './components/layout/AlertStatusBar'
import { Sidebar }           from './components/layout/Sidebar'
import { Header }            from './components/layout/Header'
import { EnvBar }            from './components/layout/EnvBar'
import { MobileNav }         from './components/layout/MobileNav'
import { SettingsPanel }     from './components/layout/SettingsPanel'
import { Map }               from './components/Map'
import { TacticalAudio }     from './components/panels/TacticalAudio'
import { EntityDetail }      from './components/panels/EntityDetail'
import { InfrastructureGrid } from './components/panels/InfrastructureGrid'
import { EnvironmentPanel }  from './components/panels/EnvironmentPanel'
import { CommunityPanel }    from './components/panels/CommunityPanel'
import { EventLogPanel }      from './components/panels/EventLogPanel'
import { EntitySearchPanel }   from './components/panels/EntitySearchPanel'
import { PlaybackController }  from './components/panels/PlaybackController'
import { GeofenceController }  from './components/panels/GeofenceController'
import { CameraModal }         from './components/panels/CameraModal'
import { IncidentsPanel }      from './components/panels/IncidentsPanel'

// ── Authenticated dashboard ────────────────────────────────────────────────────
function Dashboard() {
  useAlerts()
  useSystemHealth()

  const { activeTab, mode } = useCivicStore()
  const isCritical = mode === 'critical'

  return (
    <div
      className="dark h-screen w-screen overflow-hidden flex flex-col font-body text-sm antialiased bg-onyx-black text-on-surface"
      data-mode={mode}
    >
      <AlertStatusBar />

      <div className="flex flex-1 min-h-0">
        <Sidebar />

        <div className="relative flex-1 min-w-0 overflow-hidden transition-all duration-300">
          <div className="absolute top-0 inset-x-0 z-40 pointer-events-none">
            <div className="pointer-events-auto">
              <Header />
              <EnvBar />
            </div>
          </div>

          <div className="absolute inset-0 overflow-hidden">
            <div
              className={`
                absolute inset-0 transition-opacity duration-300
                ${activeTab === 'safety' ? 'opacity-100 z-0' : 'opacity-30 z-0'}
              `}
              aria-hidden={activeTab !== 'safety'}
            >
              <Map />
            </div>

            {activeTab !== 'safety' && (
              <div className="absolute top-24 inset-x-0 bottom-0 z-10 bg-onyx-black/40 backdrop-blur-sm overflow-y-auto">
                {activeTab === 'infrastructure' && <InfrastructureGrid />}
                {activeTab === 'environment'    && <EnvironmentPanel   />}
                {activeTab === 'community'      && <CommunityPanel     />}
                {activeTab === 'events'         && <EventLogPanel      />}
                {activeTab === 'incidents'      && <IncidentsPanel     />}
              </div>
            )}

            <TacticalAudio />

            {activeTab === 'safety' && (
              <>
                <EntitySearchPanel />
                <EntityDetail />
                <PlaybackController />
                <GeofenceController />
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
        setAuthed(true)
        setAuthChecked(true)
      })
  }, [])

  if (!authChecked) return null
  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} setupRequired={setupRequired} />
  return <Dashboard />
}
