import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useCivicStore } from '../../store'
import { DOC_PAGES, type DocPage } from '../../docs/content'

const SECTIONS = ['Guides', 'Product', 'System Design', 'Configuration'] as const

export function HelpPanel() {
  const { helpOpen, setHelpOpen } = useCivicStore()
  const [activePage, setActivePage] = useState<DocPage>(DOC_PAGES[0])

  useEffect(() => {
    if (!helpOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setHelpOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [helpOpen, setHelpOpen])

  if (!helpOpen) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Documentation">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => setHelpOpen(false)}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="absolute inset-4 lg:inset-8 bg-onyx-deep border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.8)] flex overflow-hidden">

        {/* Sidebar */}
        <aside className="w-52 shrink-0 border-r border-white/10 bg-onyx-black flex flex-col overflow-y-auto">
          <div className="px-4 py-4 border-b border-white/10 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0 text-amber-gold">
              <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
                <path d="M2 8 V2 H8"/><path d="M24 2 H30 V8"/>
                <path d="M30 24 V30 H24"/><path d="M8 30 H2 V24"/>
              </g>
              <polygon points="16,7 25,16 16,25 7,16" fill="none" stroke="currentColor" strokeWidth="2"/>
              <rect x="14" y="14" width="4" height="4" fill="#FFB800"/>
            </svg>
            <span className="font-black text-[10px] tracking-[0.2em] uppercase text-amber-gold">DOCS</span>
          </div>

          <nav className="flex-1 py-2">
            {SECTIONS.map(section => {
              const pages = DOC_PAGES.filter(p => p.section === section)
              if (pages.length === 0) return null
              return (
                <div key={section} className="mb-3">
                  <div className="px-4 py-1.5 text-[9px] font-bold tracking-[0.2em] uppercase text-on-surface-variant/60">
                    {section}
                  </div>
                  {pages.map(page => (
                    <button
                      key={page.id}
                      onClick={() => setActivePage(page)}
                      className={`w-full text-left px-4 py-2 text-[11px] transition-colors ${
                        activePage.id === page.id
                          ? 'text-amber-gold bg-amber-gold/10 border-r-2 border-amber-gold'
                          : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
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

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 shrink-0">
            <span className="font-bold text-[10px] tracking-[0.2em] uppercase text-amber-gold">
              {activePage.section} — {activePage.title}
            </span>
            <button
              onClick={() => setHelpOpen(false)}
              className="text-on-surface-variant hover:text-on-surface transition-colors p-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
              aria-label="Close documentation"
            >
              <span className="ms text-[18px]">close</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-6 prose prose-invert prose-sm max-w-3xl
            prose-headings:font-bold prose-headings:tracking-tight
            prose-h1:text-base prose-h1:text-amber-gold prose-h1:uppercase prose-h1:tracking-[0.1em] prose-h1:mb-4
            prose-h2:text-sm prose-h2:text-on-surface prose-h2:mt-6 prose-h2:mb-2
            prose-h3:text-[11px] prose-h3:text-on-surface-variant prose-h3:uppercase prose-h3:tracking-widest prose-h3:mt-4 prose-h3:mb-1
            prose-p:text-on-surface-variant prose-p:text-[12px] prose-p:leading-relaxed
            prose-li:text-on-surface-variant prose-li:text-[12px]
            prose-code:text-amber-gold prose-code:bg-white/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[11px]
            prose-pre:bg-onyx-black prose-pre:border prose-pre:border-white/10 prose-pre:text-[11px]
            prose-table:text-[11px] prose-th:text-on-surface prose-th:bg-white/5 prose-td:text-on-surface-variant
            prose-strong:text-on-surface
            prose-a:text-amber-gold prose-a:no-underline hover:prose-a:underline
          ">
            <ReactMarkdown>{activePage.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}
