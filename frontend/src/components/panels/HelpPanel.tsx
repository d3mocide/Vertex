import { useEffect, useState } from 'react'
import { useCivicStore } from '../../store'
import { DOC_PAGES, type DocPage } from '../../docs/content'

const SECTIONS = ['Usage', 'Capabilities', 'Dashboards', 'Navigation'] as const

export function HelpPanel() {
  const { helpOpen, setHelpOpen } = useCivicStore()
  const [activePage, setActivePage] = useState<DocPage>(DOC_PAGES[0])
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    if (!helpOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setHelpOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [helpOpen, setHelpOpen])

  if (!helpOpen) return null

  const handlePageSelect = (page: DocPage) => {
    setActivePage(page)
    setMobileNavOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 lg:p-8" role="dialog" aria-modal="true" aria-label="Documentation">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => setHelpOpen(false)}
        aria-hidden="true"
      />

      {/* Panel Container */}
      <div className="relative w-full h-full lg:max-w-6xl lg:h-[85vh] bg-onyx-deep border-0 lg:border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.8)] flex flex-col lg:flex-row overflow-hidden">
        
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-white/10 bg-onyx-black shrink-0">
          <button 
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="flex items-center gap-2 text-amber-gold"
          >
            <span className="ms text-[20px]">{mobileNavOpen ? 'close' : 'menu'}</span>
            <span className="font-black text-[10px] tracking-[0.2em] uppercase">Docs</span>
          </button>
          <button onClick={() => setHelpOpen(false)} className="text-on-surface-variant">
            <span className="ms text-[20px]">close</span>
          </button>
        </div>

        {/* Sidebar (Navigation) */}
        <aside className={`${
          mobileNavOpen ? 'flex' : 'hidden lg:flex'
        } absolute inset-0 z-20 lg:relative lg:inset-auto w-full lg:w-64 shrink-0 border-r border-white/10 bg-onyx-black flex-col overflow-y-auto`}>
          <div className="hidden lg:flex px-6 py-5 border-b border-white/10 items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0 text-amber-gold">
              <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
                <path d="M2 8 V2 H8"/><path d="M24 2 H30 V8"/>
                <path d="M30 24 V30 H24"/><path d="M8 30 H2 V24"/>
              </g>
              <polygon points="16,7 25,16 16,25 7,16" fill="none" stroke="currentColor" strokeWidth="2"/>
              <rect x="14" y="14" width="4" height="4" fill="#FFB800"/>
            </svg>
            <span className="font-black text-[11px] tracking-[0.25em] uppercase text-amber-gold">Documentation</span>
          </div>

          <nav className="flex-1 py-4 px-2 lg:px-0">
            {SECTIONS.map(section => {
              const pages = DOC_PAGES.filter(p => p.section === section)
              if (pages.length === 0) return null
              return (
                <div key={section} className="mb-6 lg:mb-4">
                  <div className="px-6 py-1.5 text-[10px] font-bold tracking-[0.25em] uppercase text-on-surface-variant/40 mb-1">
                    {section}
                  </div>
                  {pages.map(page => (
                    <button
                      key={page.id}
                      onClick={() => handlePageSelect(page)}
                      className={`w-full text-left px-6 py-2.5 text-[12px] lg:text-[11px] transition-all duration-200 border-l-2 ${
                        activePage.id === page.id
                          ? 'text-amber-gold bg-amber-gold/5 border-amber-gold'
                          : 'text-on-surface-variant/70 hover:text-on-surface hover:bg-white/5 border-transparent'
                      }`}
                    >
                      {page.title}
                    </button>
                  ))}
                </div>
              )
            })}
          </nav>
        </aside>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-onyx-deep relative z-10">
          {/* Content Header (Desktop) */}
          <div className="hidden lg:flex items-center justify-between px-8 py-4 border-b border-white/5 bg-white/[0.01] shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-on-surface-variant/40">{activePage.section}</span>
              <div className="w-1 h-1 rounded-full bg-amber-gold/30" />
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-amber-gold">{activePage.title}</span>
            </div>
            <button
              onClick={() => setHelpOpen(false)}
              className="text-on-surface-variant hover:text-amber-gold transition-colors p-1 group"
              aria-label="Close documentation"
            >
              <span className="ms text-[20px] group-hover:rotate-90 transition-transform duration-300">close</span>
            </button>
          </div>

          {/* Actual Content */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-8 lg:px-12 lg:py-12 max-w-5xl mx-auto w-full scroll-smooth overscroll-contain touch-auto">
            <div key={activePage.id} className="animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both">
              {activePage.content}
            </div>
            
            {/* Footer Navigation (Mobile) */}
            <div className="lg:hidden mt-12 pt-8 border-t border-white/5 flex flex-col gap-4 pb-12">
              <button 
                onClick={() => setMobileNavOpen(true)}
                className="w-full py-4 border border-white/10 rounded-xl flex items-center justify-center gap-2 text-amber-gold text-[12px] font-bold uppercase tracking-widest bg-white/[0.02]"
              >
                <span className="ms">menu</span>
                Browse Topics
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
