import { useState, useRef, useEffect } from 'react'
import { useCivicStore, NavTab, AppMode, SystemEvent } from '../../store'

const TABS: { id: NavTab; label: string; icon: string }[] = [
  { id: 'safety',         label: 'Overview',       icon: 'dashboard'      },
  { id: 'infrastructure', label: 'Infrastructure',  icon: 'traffic'        },
  { id: 'environment',    label: 'Environment',     icon: 'eco'            },
  { id: 'community',      label: 'Community',       icon: 'groups'         },
  { id: 'events',         label: 'Event Log',       icon: 'history'        },
]



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

function NotificationsDropdown({ events, onClose }: { events: SystemEvent[]; onClose: () => void }) {
  const severityColor = (s: string) => {
    if (s === 'critical' || s === 'high') return 'text-red-emergency'
    if (s === 'medium') return 'text-amber-gold'
    return 'text-on-surface-variant'
  }

  return (
    <div
      className="absolute right-0 top-full mt-2 w-80 bg-onyx-deep border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] z-50"
      role="menu"
      aria-label="Recent events"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <span className="font-bold text-[10px] tracking-[0.2em] uppercase text-amber-gold">EVENTS</span>
        <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors p-0.5 focus:outline-none" aria-label="Close">
          <span className="ms text-[16px]">close</span>
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {events.length === 0 ? (
          <div className="px-4 py-4 text-[10px] text-on-surface-variant uppercase tracking-wide">No events yet</div>
        ) : (
          [...events].reverse().map((ev) => (
            <div key={ev.event_id} className="px-4 py-2.5 border-b border-white/5 hover:bg-surface-container transition-colors">
              <div className={`font-bold text-[10px] tracking-widest uppercase ${severityColor(ev.severity)}`}>{ev.event_type.replace(/_/g, ' ')}</div>
              <div className="text-[11px] text-on-surface mt-0.5">{ev.summary}</div>
              <div className="font-mono text-[9px] text-on-surface-variant mt-0.5">{new Date(ev.ts).toLocaleTimeString()}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function Header() {
  const { activeTab, setActiveTab, mode, mobileNavOpen, setMobileNavOpen, setSettingsOpen, systemEvents } = useCivicStore()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!notificationsOpen) return
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [notificationsOpen])

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

      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileNavOpen(true)}
        className="lg:hidden text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
        aria-label="Open navigation menu"
        aria-expanded={mobileNavOpen}
      >
        <span className="ms text-[22px]">menu</span>
      </button>

      {/* Right controls */}
      <div className="flex items-center gap-4 relative z-10">
        <ModeToggle />
        <div className="h-4 w-px bg-white/10" aria-hidden="true" />


        {/* Icon buttons */}
        <div className="flex items-center gap-2 text-on-surface-variant">
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setNotificationsOpen((o) => !o)}
              className={`hover:text-amber-gold transition-colors p-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold relative ${notificationsOpen ? 'text-amber-gold' : ''}`}
              aria-label={`Notifications${systemEvents.length > 0 ? ` (${systemEvents.length})` : ''}`}
              aria-expanded={notificationsOpen}
            >
              <span className="ms text-[18px]">notifications</span>
              {systemEvents.length > 0 && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-emergency" aria-hidden="true" />
              )}
            </button>
            {notificationsOpen && (
              <NotificationsDropdown events={systemEvents} onClose={() => setNotificationsOpen(false)} />
            )}
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
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
