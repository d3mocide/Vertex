import { useState } from 'react'
import AdminMetrics from './admin/AdminMetrics'
import AdminUsers from './admin/AdminUsers'
import AdminFeeds from './admin/AdminFeeds'
import AdminDebug from './admin/AdminDebug'
import AdminRegion from './admin/AdminRegion'
import AdminSitrep from './admin/AdminSitrep'
import { AlertRulesSection } from './components/layout/AlertRulesSection'

type Section = 'metrics' | 'users' | 'feeds' | 'region' | 'sitrep' | 'alerts' | 'debug'

const NAV: { id: Section; label: string; icon: string; blurb: string }[] = [
  { id: 'metrics', label: 'Health', icon: 'monitoring', blurb: 'Services, pollers, ingestion and data quality' },
  { id: 'users', label: 'Users', icon: 'group', blurb: 'Accounts, roles, passwords and API keys' },
  { id: 'feeds', label: 'Feeds', icon: 'rss_feed', blurb: 'Radio streams, news feeds, pollers and alert zones' },
  { id: 'region', label: 'Region', icon: 'public', blurb: 'Where this install is, region packs and their keys' },
  { id: 'sitrep', label: 'Sitrep', icon: 'psychology', blurb: 'How well the AI briefings cover what happened' },
  { id: 'alerts', label: 'Alerts', icon: 'notifications_active', blurb: 'Rules that post webhooks and deliver briefings' },
  { id: 'debug', label: 'Debug', icon: 'bug_report', blurb: 'Probe remote feeds for silent failures' },
]

const SECTION_KEY = 'vertex.admin.section'

function loadSection(): Section {
  try {
    const s = localStorage.getItem(SECTION_KEY)
    if (NAV.some((n) => n.id === s)) return s as Section
  } catch { /* storage unavailable */ }
  return 'metrics'
}

// Canonical Scope mark (design system).
function ScopeMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="text-white shrink-0">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
        <path d="M2 8 V2 H8"/>
        <path d="M24 2 H30 V8"/>
        <path d="M30 24 V30 H24"/>
        <path d="M8 30 H2 V24"/>
      </g>
      <polygon points="16,7 25,16 16,25 7,16" fill="none" stroke="currentColor" strokeWidth="2"/>
      <rect x="14" y="14" width="4" height="4" fill="#FFB800"/>
    </svg>
  )
}

export default function AdminApp() {
  const [active, setActive] = useState<Section>(loadSection)
  const current = NAV.find((n) => n.id === active)!

  const select = (id: Section) => {
    setActive(id)
    try { localStorage.setItem(SECTION_KEY, id) } catch { /* storage unavailable */ }
    document.getElementById('admin-main')?.scrollTo({ top: 0 })
  }

  return (
    <div className="dark flex flex-col md:flex-row h-full w-full bg-onyx-black text-on-surface font-body text-sm antialiased overflow-hidden pt-safe-chrome md:pt-0">
      {/* Solid backdrop behind the iOS status bar (and its edge blur). */}
      <div className="fixed top-0 inset-x-0 z-30 pointer-events-none bg-onyx-deep h-safe-chrome md:hidden" aria-hidden="true" />

      {/* Phone: header + tab bar */}
      <div className="md:hidden shrink-0 bg-onyx-deep border-b border-white/10 select-none">
        <div className="flex items-center justify-between px-4 h-12">
          <div className="flex items-center gap-2.5">
            <ScopeMark size={20} />
            <span className="text-[14px] font-black tracking-wider uppercase">Vertex</span>
            <span className="font-mono text-[10px] tracking-[0.2em] text-amber-gold uppercase">Admin</span>
          </div>
          <a href="/" className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
            <span className="ms text-[16px]" aria-hidden="true">map</span>
            Map
          </a>
        </div>
        <nav className="grid grid-cols-7 border-t border-white/5" aria-label="Admin sections">
          {NAV.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => select(id)}
              aria-current={active === id ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors ${
                active === id
                  ? 'text-amber-gold border-amber-gold bg-amber-gold/10'
                  : 'text-on-surface-variant border-transparent hover:text-on-surface'
              }`}
            >
              <span className={`ms text-[20px] ${active === id ? 'ms-fill' : ''}`} aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Desktop: sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-amber-gold/20 bg-onyx-deep">
        <div className="flex items-center gap-3 px-4 h-16 border-b border-white/10">
          <ScopeMark size={28} />
          <div className="flex flex-col leading-none gap-1">
            <span className="text-[16px] font-black tracking-wider uppercase">Vertex</span>
            <span className="font-mono text-[9px] tracking-[0.2em] text-amber-gold uppercase">Admin console</span>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 p-2 flex-1" aria-label="Admin sections">
          {NAV.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => select(id)}
              aria-current={active === id ? 'page' : undefined}
              className={`flex items-center gap-3 px-3 py-2 text-[12px] font-bold uppercase tracking-widest border-l-2 transition-colors ${
                active === id
                  ? 'bg-amber-gold/10 text-amber-gold border-amber-gold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5 border-transparent'
              }`}
            >
              <span className={`ms text-[18px] ${active === id ? 'ms-fill' : ''}`} aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="p-2 border-t border-white/10">
          <a href="/" className="flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
            <span className="ms text-[16px]" aria-hidden="true">arrow_back</span>
            Back to map
          </a>
        </div>
      </aside>

      {/* Content */}
      <main id="admin-main" className="flex-1 min-w-0 overflow-y-auto overscroll-contain">
        <header className="hidden md:flex items-baseline gap-4 px-6 h-16 border-b border-white/10 bg-onyx-deep/80">
          <h1 className="self-center text-[16px] font-black uppercase tracking-wider">{current.label}</h1>
          <p className="self-center text-[12px] text-on-surface-variant">{current.blurb}</p>
        </header>
        <div className="px-4 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))] md:p-6">
          {active === 'metrics' && <AdminMetrics />}
          {active === 'users' && <AdminUsers />}
          {active === 'feeds' && <AdminFeeds />}
          {active === 'region' && <AdminRegion />}
          {active === 'sitrep' && <AdminSitrep />}
          {active === 'alerts' && (
            <div className="max-w-2xl">
              <AlertRulesSection open />
            </div>
          )}
          {active === 'debug' && <AdminDebug />}
        </div>
      </main>
    </div>
  )
}
