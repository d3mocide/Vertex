import { useState, useEffect } from 'react'
import { useCivicPick } from './store'
import { useAlerts } from './hooks/useAlerts'
import { useSystemHealth } from './hooks/useSystemHealth'
import { useTrailHydration } from './hooks/useTrailHydration'
import { usePreferences } from './hooks/usePreferences'
import { useMeshHistory } from './hooks/useMeshHistory'
import { LoginPage } from './components/LoginPage'
import { getUserRole, setSession } from './auth'
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
import { LayersController }    from './components/panels/LayersController'
import { CameraModal }         from './components/panels/CameraModal'
import { IncidentsPanel }      from './components/panels/IncidentsPanel'
import { CommsPanel }          from './components/panels/CommsPanel'
import { FlightLogPanel }      from './components/panels/FlightLogPanel'
import { AnnotationController } from './components/panels/AnnotationController'
import { InstallPrompt } from './components/InstallPrompt'
import { DevTools } from './components/dev/DevTools'
import { MapErrorBoundary } from './components/MapErrorBoundary'
import { loadRegion } from './region'
import { fetchSetupStatus, type SetupStatus } from './setup'
import { SetupWizard } from './components/SetupWizard'

// ── Authenticated dashboard ────────────────────────────────────────────────────
function Dashboard() {
  useAlerts()
  useSystemHealth()
  useTrailHydration()
  usePreferences()
  useMeshHistory()

  const { news, appendSystemEvent } = useCivicPick('news', 'appendSystemEvent')

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

  const { activeTab, mode } = useCivicPick('activeTab', 'mode')
  // Phones: map tools (replay / zones / annotate) sit behind one button.
  const [mapToolsOpen, setMapToolsOpen] = useState(false)
  // On phones the Layers sheet covers the other tools, so they step aside while it is open.
  const [layersOpen, setLayersOpen] = useState(false)
  const isCritical = mode === 'critical'

  return (
    <div
      className="dark h-full w-full overflow-hidden flex flex-col font-body text-sm antialiased bg-onyx-black text-on-surface lg:pt-safe-chrome pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0"
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
        <MapErrorBoundary><Map /></MapErrorBoundary>
      </div>

      {/* Status-bar band (iPad / large screens) — a solid backdrop for the
          status bar. Solid rather than frosted: a blurred live map read as a
          smear. Collapses to 0 height where there is no inset. */}
      <div
        className="hidden lg:block fixed top-0 inset-x-0 z-30 pointer-events-none bg-onyx-deep h-safe-chrome"
        aria-hidden="true"
      />

      {/* Phones: one top bar. Its surface runs up under the status bar (and
          the iOS 26+ edge blur, which only has plain colour to smear), with
          the header and then the advisory strip at its bottom edge — a
          separate dark band above an amber strip read as an empty gap. */}
      <div className="lg:hidden shrink-0 relative z-40 pt-safe-chrome bg-onyx-deep/90 backdrop-blur-md shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
        {isCritical && <div className="absolute inset-0 bg-red-emergency/5 pointer-events-none" aria-hidden="true" />}
        <Header flush />
        <AlertStatusBar />
      </div>

      <div className="hidden lg:block shrink-0">
        <AlertStatusBar />
      </div>

      <div className="flex flex-1 min-h-0 relative z-10 pointer-events-none">
        <div className="hidden lg:flex pointer-events-auto h-full shrink-0">
          <Sidebar />
        </div>

        <div className="relative flex-1 min-w-0 overflow-hidden transition-all duration-300 pointer-events-none">
          <div className="hidden lg:block absolute top-0 inset-x-0 z-40 pointer-events-none">
            <div className="pointer-events-auto">
              <Header />
              <EnvBar />
            </div>
          </div>

          <div className="absolute inset-0 overflow-hidden pointer-events-none *:pointer-events-auto">

            {/* Page scroller. Bottom padding reserves room for the audio bar
                (docked above the nav on mobile, floating on desktop) so it
                never covers the end of a page. */}
            {activeTab !== 'safety' && (
              <div id="page-scroll" className="absolute top-0 lg:top-24 inset-x-0 bottom-0 z-10 bg-onyx-black/40 backdrop-blur-xs overflow-y-auto pb-14 lg:pb-24">
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
                <div className={layersOpen ? 'hidden lg:contents' : 'contents'}>
                  <EntitySearchPanel />
                </div>
                <EntityDetail />
                <div className="absolute top-2 lg:top-28 left-2 lg:left-[352px] flex flex-col lg:flex-row items-start gap-2 z-30 pointer-events-none *:pointer-events-auto">
                  <button
                    type="button"
                    onClick={() => setMapToolsOpen((v) => !v)}
                    aria-expanded={mapToolsOpen}
                    className={`lg:hidden h-10 px-3 flex items-center gap-2 border backdrop-blur-md font-bold text-[11px] uppercase tracking-widest transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold ${mapToolsOpen ? 'bg-amber-gold text-onyx-black border-amber-gold' : 'bg-onyx-black/70 border-amber-gold/40 text-amber-gold'}`}
                  >
                    <span className="ms text-[18px] leading-none" aria-hidden="true">{mapToolsOpen ? 'close' : 'construction'}</span>
                    Tools
                  </button>
                  <div className={`${mapToolsOpen ? 'flex' : 'hidden'} lg:flex flex-col lg:flex-row items-start gap-2`}>
                    <div className={layersOpen ? 'hidden lg:contents' : 'contents'}>
                      <PlaybackController />
                      <GeofenceController />
                      <AnnotationController />
                    </div>
                    <LayersController onOpenChange={setLayersOpen} />
                  </div>
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
      <DevTools />
    </div>
  )
}

// ── Auth gate ─────────────────────────────────────────────────────────────────
export default function App() {
  const [authChecked, setAuthChecked]     = useState(false)
  const [authed, setAuthed]               = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)
  const [regionReady, setRegionReady]   = useState(false)
  const [authEnabled, setAuthEnabled]     = useState(true)
  const [setup, setSetup]                 = useState<SetupStatus | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/auth/status`)
      .then(r => r.json())
      .then(async ({ auth_enabled, setup_required }: { auth_enabled: boolean; setup_required: boolean }) => {
        setSetupRequired(setup_required)
        setAuthEnabled(auth_enabled)
        if (!auth_enabled) {
          setAuthed(true)
        } else if (!setup_required) {
          const me = await fetch(`${API_BASE}/auth/me`)
          if (me.ok) {
            const profile = await me.json() as { username: string; role: 'admin' | 'viewer' }
            setSession(profile)
            setAuthed(true)
          }
        }
        setAuthChecked(true)
      })
      .catch(() => {
        setAuthed(false)
        setAuthChecked(true)
      })
  }, [])

  // Once signed in, learn the operator's region (map center, name) before the dashboard mounts.
  useEffect(() => {
    if (!authed) return
    // The region and the first-run status are needed before the dashboard can be shown.
    void Promise.all([loadRegion(), fetchSetupStatus().catch(() => null)]).then(([, status]) => {
      setSetup(status)
      setRegionReady(true)
    })
  }, [authed])

  const splash = (
    <div className="w-full h-full bg-onyx-black flex flex-col items-center justify-center gap-6">
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
        <span className="text-[16px] font-black tracking-wider text-white uppercase select-none">VERTEX</span>
        <span className="font-mono text-[11px] tracking-[0.2em] text-amber-gold uppercase select-none">SITUATIONAL AWARENESS</span>
      </div>
    </div>
  )
  if (!authChecked) return splash
  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} setupRequired={setupRequired} />
  if (!regionReady) return splash
  // Fresh install: nothing chooses a region yet. Admins run the wizard; anyone else waits for them.
  if (setup?.needs_setup) {
    const isAdmin = authEnabled && getUserRole() === 'admin'
    if (isAdmin) return <SetupWizard firstRun onClose={() => undefined} />
    return (
      <div className="w-full h-full bg-onyx-black flex items-center justify-center p-6">
        <div className="hud-panel p-6 max-w-md text-[13px] text-on-surface-variant stack-y-2">
          <div className="label-caps text-amber-gold">Setup not finished</div>
          <p>Vertex has not been set up for a location yet. Enable authentication and ask an administrator to sign in and finish setup, then reload this page.</p>
        </div>
      </div>
    )
  }
  return <Dashboard />
}
