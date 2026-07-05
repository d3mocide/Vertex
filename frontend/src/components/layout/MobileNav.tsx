import { useState } from 'react'
import { NavTab, useCivicPick } from '../../store'
import { exportDashboardSnapshot } from '../../snapshotExport'

const PRIMARY_TABS: { id: NavTab; label: string; icon: string }[] = [
  { id: 'safety',         label: 'Map',     icon: 'dashboard'  },
  { id: 'incidents',      label: 'Alerts',  icon: 'report'     },
  { id: 'comms',          label: 'Comms',   icon: 'forum'      },
  { id: 'environment',    label: 'Env',     icon: 'eco'        },
]

const SECONDARY_TABS: { id: NavTab; label: string; icon: string }[] = [
  { id: 'infrastructure', label: 'Infrastructure', icon: 'traffic' },
  { id: 'intel',          label: 'Intel',          icon: 'psychology' },
  { id: 'flightlog',      label: 'Flights',        icon: 'flight'  },
  { id: 'events',         label: 'System Log',     icon: 'history' },
]

export function MobileNav() {
  const { activeTab, setActiveTab, setSettingsOpen, setHelpOpen } = useCivicPick('activeTab', 'setActiveTab', 'setSettingsOpen', 'setHelpOpen')
  const [showMore, setShowMore] = useState(false)

  const handleTabClick = (id: NavTab) => {
    setActiveTab(id)
    setShowMore(false)
  }

  return (
    <>
      {/* More Drawer Overlay */}
      {showMore && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div 
            className="absolute inset-0 bg-onyx-black/80 backdrop-blur-sm"
            onClick={() => setShowMore(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-onyx-deep border-t border-white/10 p-6 pb-[4.25rem] animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center justify-between mb-6">
              <span className="label-caps text-amber-gold">// OPS CHANNELS</span>
              <button onClick={() => setShowMore(false)} className="text-on-surface-variant">
                <span className="ms text-[20px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {SECONDARY_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  className={`flex items-center gap-3 p-4 border transition-colors ${
                    activeTab === tab.id 
                      ? 'bg-amber-gold/10 border-amber-gold text-amber-gold' 
                      : 'bg-white/[0.03] border-white/5 text-on-surface-variant hover:text-white'
                  }`}
                >
                  <span className="ms text-[20px]">{tab.icon}</span>
                  <span className="text-[11px] font-bold tracking-widest uppercase">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav
        className="fixed bottom-0 left-0 right-0 z-50 lg:hidden flex bg-white/[0.03] border-t border-white/[0.06] backdrop-blur-md shadow-[0_-4px_30px_rgba(0,0,0,0.5)] pb-safe"
        aria-label="Mobile navigation"
      >
        {/* Glass reflection — mirrors the header so the bar reads as one piece
            of chrome while the live map shows through to the bottom edge. */}
        <div className="absolute inset-0 bg-gradient-to-t from-white/5 to-transparent pointer-events-none" aria-hidden="true" />

        {/* Amber accent line along the top edge — mirrors the header underline. */}
        <div
          className="absolute left-0 right-0 top-[-1px] h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, #FFB800 20%, #FFB800 80%, transparent)', opacity: 0.35 }}
          aria-hidden="true"
        />

        {PRIMARY_TABS.map((tab) => {
          const active = activeTab === tab.id && !showMore
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`relative flex-1 h-14 flex flex-col items-center justify-center gap-0.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${
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

        {/* More Button */}
        <button
          onClick={() => setShowMore(!showMore)}
          className={`relative flex-1 h-14 flex flex-col items-center justify-center gap-0.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${
            showMore ? 'text-amber-gold' : 'text-on-surface-variant hover:text-on-surface'
          }`}
          aria-label="More options"
        >
          <span className="ms text-[20px] leading-none" aria-hidden="true">
            {showMore ? 'expand_more' : 'more_horiz'}
          </span>
          <span className="text-[11px] font-bold tracking-widest uppercase">More</span>
          {showMore && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-amber-gold" aria-hidden="true" />
          )}
        </button>
      </nav>
    </>
  )
}
