import React, { useState } from 'react'
import AdminMetrics from './admin/AdminMetrics'
import AdminUsers from './admin/AdminUsers'
import AdminFeeds from './admin/AdminFeeds'
import AdminDebug from './admin/AdminDebug'

type Section = 'metrics' | 'users' | 'feeds' | 'debug'

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'metrics', label: 'Metrics', icon: 'monitoring' },
  { id: 'users', label: 'Users', icon: 'group' },
  { id: 'feeds', label: 'Feeds', icon: 'rss_feed' },
  { id: 'debug', label: 'Debug', icon: 'bug_report' },
]

export default function AdminApp() {
  const [active, setActive] = useState<Section>('metrics')

  return (
    <div className="flex flex-col md:flex-row h-full w-full bg-[#0a0a0f] text-gray-200 font-mono overflow-hidden">
      {/* Mobile Top Header & Navigation */}
      <div className="md:hidden flex flex-col border-b border-white/10 bg-black/40 shrink-0 select-none">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-amber-gold text-sm font-bold tracking-widest">VERTEX</span>
            <span className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-0.5">Admin</span>
          </div>
          <a
            href="/"
            className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            Map
          </a>
        </div>
        <nav className="flex overflow-x-auto divide-x divide-white/5 border-t border-white/5 scrollbar-none">
          {NAV.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`flex-1 min-w-[75px] flex flex-col items-center gap-0.5 py-1.5 text-[10px] uppercase transition-colors shrink-0 ${
                active === id
                  ? 'bg-amber-gold/10 text-amber-gold border-b-2 border-amber-gold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Sidebar (Desktop Only) */}
      <aside className="hidden md:flex flex-col w-52 shrink-0 border-r border-white/10 bg-black/40">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-white/10">
          <span className="text-amber-gold text-lg font-bold tracking-widest">VERTEX</span>
          <span className="text-[11px] text-on-surface-variant uppercase tracking-widest mt-1">Admin</span>
        </div>

        <nav className="flex flex-col gap-1 p-2 flex-1">
          {NAV.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                active === id
                  ? 'bg-amber-gold/10 text-amber-gold border-l-2 border-amber-gold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5 border-l-2 border-transparent'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className="p-2 border-t border-white/10">
          <a
            href="/"
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to Map
          </a>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <header className="hidden md:flex sticky top-0 z-10 flex items-center px-6 py-3 border-b border-white/10 bg-black/60 backdrop-blur-sm">
          <h1 className="text-sm font-semibold text-gray-300 uppercase tracking-widest">
            {NAV.find((n) => n.id === active)?.label}
          </h1>
        </header>
        <div className="p-4 md:p-6">
          {active === 'metrics' && <AdminMetrics />}
          {active === 'users' && <AdminUsers />}
          {active === 'feeds' && <AdminFeeds />}
          {active === 'debug' && <AdminDebug />}
        </div>
      </main>
    </div>
  )
}
