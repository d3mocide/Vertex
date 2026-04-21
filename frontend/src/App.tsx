import { useCivicStore } from './store'
import { useAlerts } from './hooks/useAlerts'
import { useSystemHealth } from './hooks/useSystemHealth'

import { AlertStatusBar }    from './components/layout/AlertStatusBar'
import { Sidebar }           from './components/layout/Sidebar'
import { Header }            from './components/layout/Header'
import { EnvBar }            from './components/layout/EnvBar'
import { Map }               from './components/Map'
import { TacticalAudio }     from './components/panels/TacticalAudio'
import { EntityDetail }      from './components/panels/EntityDetail'
import { InfrastructureGrid } from './components/panels/InfrastructureGrid'
import { EnvironmentPanel }  from './components/panels/EnvironmentPanel'
import { CommunityPanel }    from './components/panels/CommunityPanel'

export default function App() {
  // Bootstrap data connections
  useAlerts()
  useSystemHealth()

  const { activeTab, mode } = useCivicStore()
  const isCritical = mode === 'critical'

  return (
    <div
      className="dark h-screen w-screen overflow-hidden flex flex-col font-body text-sm antialiased bg-onyx-black text-on-surface"
      data-mode={mode}
    >
      {/* Traffic-light status bar — spans full width */}
      <AlertStatusBar />

      <div className="flex flex-1 min-h-0">
        {/* ── Left sidebar ───────────────────────────────────────────── */}
        <Sidebar />

        {/* ── Main content area ──────────────────────────────────────── */}
        <div
          className="relative flex-1 min-w-0 overflow-hidden transition-all duration-300"
        >
          {/* Top floating glass controls */}
          <div className="absolute top-0 inset-x-0 z-40 pointer-events-none">
            <div className="pointer-events-auto">
              <Header />
              <EnvBar />
            </div>
          </div>

          {/* Content area — map fills the entire parent area */}
          <div className="absolute inset-0 overflow-hidden">


            {/* Map — always rendered so data stays live */}
            <div
              className={`
                absolute inset-0 transition-opacity duration-300
                ${activeTab === 'safety' ? 'opacity-100 z-0' : 'opacity-30 z-0'}
              `}
              aria-hidden={activeTab !== 'safety'}
            >
              <Map />
            </div>

            {/* ── Tab panels (overlay map) ─────────────────────────── */}
            {activeTab !== 'safety' && (
              <div className="absolute top-24 inset-x-0 bottom-0 z-10 bg-onyx-black/40 backdrop-blur-sm overflow-y-auto">
                {activeTab === 'infrastructure' && <InfrastructureGrid />}

                {activeTab === 'environment'    && <EnvironmentPanel   />}
                {activeTab === 'community'      && <CommunityPanel     />}
              </div>
            )}



            {/* ── Safety-tab overlays (only on safety/map view) ────── */}
            {activeTab === 'safety' && (
              <>
                {/* Tactical audio HUD — persistent */}
                <TacticalAudio />

                {/* Entity detail card — appears on entity click */}
                <EntityDetail />
              </>
            )}

            {/* ── Critical mode: force audio + entity visible ───────── */}
            {isCritical && activeTab !== 'safety' && (
              <>
                <TacticalAudio />
                <EntityDetail />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Skip-to-main accessibility link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 btn-primary"
      >
        Skip to main content
      </a>
    </div>
  )
}
