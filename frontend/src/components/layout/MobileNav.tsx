import { useCivicStore, NavTab } from '../../store'

const TABS: { id: NavTab; label: string; icon: string }[] = [
  { id: 'safety',         label: 'Map',     icon: 'dashboard'  },
  { id: 'incidents',      label: 'Alerts',  icon: 'report'     },
  { id: 'environment',    label: 'Env',     icon: 'eco'        },
  { id: 'comms',          label: 'Comms',   icon: 'forum'      },
  { id: 'flightlog',      label: 'Flights', icon: 'flight'     },
  { id: 'events',         label: 'Log',     icon: 'history'    },
]

export function MobileNav() {
  const { activeTab, setActiveTab } = useCivicStore()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 lg:hidden h-14 flex bg-onyx-deep/95 border-t border-white/10 backdrop-blur-md safe-area-inset-bottom"
      aria-label="Mobile navigation"
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${
              active ? 'text-amber-gold' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            aria-current={active ? 'page' : undefined}
          >
            <span
              className="ms text-[20px] leading-none"
              aria-hidden="true"
              style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
            >
              {tab.icon}
            </span>
            <span className="text-[11px] font-bold tracking-widest uppercase">{tab.label}</span>
            {active && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-amber-gold" aria-hidden="true" />
            )}
          </button>
        )
      })}
    </nav>
  )
}
