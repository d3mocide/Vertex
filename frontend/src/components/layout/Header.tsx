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

export function Header() {
  const { activeTab, setActiveTab, mode } = useCivicStore()

  return (
    <header
      className={`
        border-b flex justify-between items-center w-full px-4 h-14 shrink-0
        transition-colors duration-300
        ${mode === 'critical'
          ? 'bg-red-emergency-muted/40 border-red-emergency/40 backdrop-blur-md'
          : 'bg-onyx-black/40 border-amber-gold-muted/30 backdrop-blur-md'}
      `}
    >
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
      <div className="flex items-center gap-3">
        <SystemHealthBadge />
        <ModeToggle />

        {/* Divider */}
        <div className="divider-v" aria-hidden="true" />

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
