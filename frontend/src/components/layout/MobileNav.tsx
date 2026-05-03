import { useEffect } from 'react'
import { useCivicStore, NavTab } from '../../store'

const TABS: { id: NavTab; label: string; icon: string }[] = [
  { id: 'safety',         label: 'Overview',       icon: 'dashboard'      },
  { id: 'incidents',      label: 'Incidents',       icon: 'report'         },
  { id: 'infrastructure', label: 'Infrastructure',  icon: 'traffic'        },
  { id: 'environment',    label: 'Environment',     icon: 'eco'            },
  { id: 'community',      label: 'Community',       icon: 'groups'         },
  { id: 'events',         label: 'Event Log',       icon: 'history'        },
]

export function MobileNav() {
  const { mobileNavOpen, setMobileNavOpen, activeTab, setActiveTab } = useCivicStore()

  // Close on Escape
  useEffect(() => {
    if (!mobileNavOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileNavOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mobileNavOpen, setMobileNavOpen])

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileNavOpen])

  if (!mobileNavOpen) return null

  const handleTab = (id: NavTab) => {
    setActiveTab(id)
    setMobileNavOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-onyx-black/80 backdrop-blur-sm"
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="absolute left-0 top-0 bottom-0 w-64 bg-onyx-deep border-r border-white/10 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-white/10 shrink-0">
          <span className="font-bold text-[11px] tracking-[0.2em] uppercase text-amber-gold">VERTEX</span>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="text-on-surface-variant hover:text-amber-gold transition-colors p-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
            aria-label="Close navigation menu"
          >
            <span className="ms text-[22px]">close</span>
          </button>
        </div>

        {/* Nav tabs */}
        <nav className="flex-1 py-4" aria-label="Main navigation">
          {TABS.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => handleTab(tab.id)}
                className={`
                  w-full flex items-center gap-4 px-5 py-4 text-left transition-colors
                  focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold
                  ${active
                    ? 'text-amber-gold border-l-2 border-amber-gold bg-amber-gold/5'
                    : 'text-on-surface-variant hover:text-on-surface border-l-2 border-transparent hover:bg-surface-container'}
                `}
                aria-current={active ? 'page' : undefined}
              >
                <span className="ms text-[20px] leading-none" aria-hidden="true">{tab.icon}</span>
                <span className="font-bold text-[11px] tracking-widest uppercase">{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
