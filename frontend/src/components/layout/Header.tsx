import { useCivicStore, NavTab, AppMode } from '../../store'

const TABS: { id: NavTab; label: string; icon: string }[] = [
  { id: 'safety',         label: 'Safety',         icon: 'shield'         },
  { id: 'infrastructure', label: 'Infrastructure',  icon: 'traffic'        },
  { id: 'environment',    label: 'Environment',     icon: 'eco'            },
  { id: 'community',      label: 'Community',       icon: 'groups'         },
]

function SystemHealthBadge() {
  const { health, connected } = useCivicStore()
  const ok = health.ok && connected

  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-1 border
        ${ok
          ? 'bg-surface-container/80 border-amber-gold-muted'
          : 'bg-red-emergency-muted border-red-emergency/60'}
      `}
      aria-label={`System health: ${ok ? 'OK' : 'Degraded'}`}
      title={`System health: ${ok ? 'OK' : 'Degraded'} · Redis: ${health.redis ? 'up' : 'down'}`}
    >
      <span
        className={`ms text-[16px] leading-none ${ok ? 'text-amber-gold' : 'text-red-emergency'}`}
        aria-hidden="true"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        monitor_heart
      </span>
      <span className={`font-mono text-[11px] ${ok ? 'text-amber-gold' : 'text-red-emergency'}`}>
        {ok ? 'SYS_OK' : 'DEGRADED'}
      </span>
    </div>
  )
}

function ModeToggle() {
  const { mode, setMode } = useCivicStore()

  const toggle = (next: AppMode) => setMode(next)

  return (
    <div
      className="flex items-center gap-0 bg-onyx-deep/80 border border-amber-gold-muted p-1"
      role="group"
      aria-label="Dashboard mode"
    >
      <button
        onClick={() => toggle('calm')}
        className={`px-3 py-0.5 font-bold text-[10px] uppercase tracking-widest transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${
          mode === 'calm'
            ? 'bg-amber-gold text-onyx-black'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
        aria-pressed={mode === 'calm'}
      >
        CALM
      </button>
      <button
        onClick={() => toggle('critical')}
        className={`px-3 py-0.5 font-bold text-[10px] uppercase tracking-widest transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${
          mode === 'critical'
            ? 'bg-red-emergency text-white'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
        aria-pressed={mode === 'critical'}
      >
        CRITICAL
      </button>
    </div>
  )
}

function CameraToggle() {
  const { camerasVisible, setCamerasVisible } = useCivicStore()

  return (
    <button
      onClick={() => setCamerasVisible(!camerasVisible)}
      className={`
        flex items-center gap-2 px-3 py-1 border font-mono text-[10px] uppercase tracking-widest transition-colors
        focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold
        ${camerasVisible
          ? 'border-amber-gold text-amber-gold bg-amber-gold/10'
          : 'border-amber-gold-muted text-on-surface-variant hover:text-on-surface'}
      `}
      aria-pressed={camerasVisible}
      aria-label={`Cameras ${camerasVisible ? 'enabled' : 'disabled'}`}
      title="Toggle traffic camera map layer"
    >
      <span className="ms text-[14px] leading-none" aria-hidden="true">videocam</span>
      <span>{camerasVisible ? 'CAMERAS ON' : 'CAMERAS OFF'}</span>
    </button>
  )
}

function RadarToggle() {
  const { radarVisible, setRadarVisible } = useCivicStore()

  return (
    <button
      onClick={() => setRadarVisible(!radarVisible)}
      className={`
        flex items-center gap-2 px-3 py-1 border font-mono text-[10px] uppercase tracking-widest transition-colors
        focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold
        ${radarVisible
          ? 'border-green-ais text-green-ais bg-green-ais/10'
          : 'border-amber-gold-muted text-on-surface-variant hover:text-on-surface'}
      `}
      aria-pressed={radarVisible}
      aria-label={`Radar ${radarVisible ? 'enabled' : 'disabled'}`}
      title="Toggle NEXRAD radar layer"
    >
      <span className="ms text-[14px] leading-none" aria-hidden="true">radar</span>
      <span>{radarVisible ? 'RADAR ON' : 'RADAR OFF'}</span>
    </button>
  )
}

export function Header() {
  const { activeTab, setActiveTab, mode } = useCivicStore()

  return (
    <header
      className={`
        border-b flex justify-between items-center w-full px-6 h-14 shrink-0
        transition-all duration-500 relative overflow-hidden
        ${mode === 'critical'
          ? 'bg-red-emergency/5 border-red-emergency/20 backdrop-blur-md'
          : 'bg-white/[0.03] border-white/10 backdrop-blur-md shadow-[0_4px_30px_rgba(0,0,0,0.5)]'}
      `}
    >
      {/* Glass reflection effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />

      {/* Navigation tabs */}
      <nav
        className="hidden lg:flex items-center gap-6 h-full"
        aria-label="Main navigation"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? 'nav-link-active' : 'nav-link'}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <span
              className="ms text-[14px] mr-1.5 leading-none hidden xl:inline"
              aria-hidden="true"
            >
              {tab.icon}
            </span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Mobile hamburger placeholder */}
      <button
        className="lg:hidden text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
        aria-label="Open navigation menu"
      >
        <span className="ms text-[22px]">menu</span>
      </button>

      {/* Right controls */}
      <div className="flex items-center gap-4 relative z-10">
        <SystemHealthBadge />
        <CameraToggle />
        <RadarToggle />
        <ModeToggle />

        {/* Critical Mode Status Button from Mockup */}
        <div className={`
          px-4 py-1.5 border font-bold text-[10px] uppercase tracking-[0.2em] transition-all duration-300
          ${mode === 'critical' 
            ? 'bg-red-emergency/20 border-red-emergency text-red-emergency shadow-[0_0_15px_rgba(255,59,48,0.3)]' 
            : 'border-amber-gold/30 text-amber-gold/50'}
        `}>
          {mode === 'critical' ? 'CRITICAL ACTIVE' : 'CRITICAL MODE'}
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-white/10" aria-hidden="true" />


        {/* Icon buttons */}
        <div className="flex items-center gap-2 text-on-surface-variant">
          <button
            className="hover:text-amber-gold transition-colors p-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
            aria-label="Notifications"
          >
            <span className="ms text-[18px]">notifications</span>
          </button>
          <button
            className="hover:text-amber-gold transition-colors p-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
            aria-label="Settings"
          >
            <span className="ms text-[18px]">settings</span>
          </button>
        </div>
      </div>
    </header>
  )
}
