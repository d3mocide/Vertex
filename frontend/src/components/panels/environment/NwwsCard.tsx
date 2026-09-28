import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'

interface NwwsProduct {
  code: string
  name: string
  office: string
  issuance_time: string | null
  text: string
}

const CODE_ICONS: Record<string, string> = {
  AFD: 'cloud',
  HWO: 'warning',
  LSR: 'storm',
  CF6: 'calendar_month',
}

const CODE_COLORS: Record<string, string> = {
  AFD: 'text-sky-400',
  HWO: 'text-amber-400',
  LSR: 'text-red-400',
  CF6: 'text-violet-400',
}

function formatIso(ts: string | null | undefined): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ts
  }
}

/**
 * NWS products arrive as raw teletype text: a WMO header ("000",
 * "FXUS66 KPQR 260502", "AFDPQR") and "&&" / "$$" separators. Strip those so
 * the card shows the forecaster's words, not transmission framing.
 */
function readable(text: string): string {
  return text
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !(/^\d{3}$/.test(t) || /^[A-Z]{4}\d{2} [A-Z]{4} \d{6}/.test(t) || /^[A-Z]{6}$/.test(t)
        || t === '&&' || t === '$$')
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Short plain-language preview: the AFD synopsis when present, else the opening lines. */
function preview(p: NwwsProduct): string {
  const clean = readable(p.text)
  const synopsis = clean.match(/\.SYNOPSIS\.{3}([\s\S]*?)(?:\n\s*\n|\n\.[A-Z])/)
  const body = synopsis ? synopsis[1] : clean.split('\n').slice(0, 4).join(' ')
  return body.replace(/\s+/g, ' ').trim()
}

export function NwwsCard() {
  const [products, setProducts] = useState<NwwsProduct[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/weather/nwws`, { headers: authHeaders() })
        if (res.ok) setProducts(await res.json())
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 30 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // CF6 is a monthly climate table — reference data, not situational awareness.
  const shown = products.filter((p) => p.code !== 'CF6')
  if (shown.length === 0) return null

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-sky-400" aria-hidden="true">feed</span>
        NWS TEXT PRODUCTS
        <span className="ml-auto font-mono text-[11px] text-on-surface-variant">{shown[0]?.office}</span>
      </div>

      <div className="space-y-2">
        {shown.map((p) => {
          const isOpen = expanded === p.code
          const color = CODE_COLORS[p.code] ?? 'text-gray-400'
          const icon = CODE_ICONS[p.code] ?? 'article'
          return (
            <div key={p.code} className="border border-white/10 bg-white/[0.02]">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
                onClick={() => setExpanded(isOpen ? null : p.code)}
                aria-expanded={isOpen}
              >
                <span className={`ms text-[12px] leading-none ${color}`} aria-hidden="true">{icon}</span>
                <span className={`text-[11px] lg:text-[12px] font-bold ${color} uppercase tracking-wide flex-1`}>{p.name}</span>
                <span className="font-mono text-[11px] text-on-surface-variant shrink-0">
                  {formatIso(p.issuance_time)}
                </span>
                <span className="ms text-[12px] leading-none text-on-surface-variant ml-1" aria-hidden="true">
                  {isOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>

              {isOpen && p.text && (
                <div className="border-t border-white/5 px-3 py-2">
                  <pre className="font-mono text-[11px] text-on-surface-variant whitespace-pre-wrap break-words leading-relaxed max-h-72 overflow-y-auto">
                    {readable(p.text)}
                  </pre>
                </div>
              )}

              {!isOpen && p.text && (
                <div className="border-t border-white/5 px-3 pb-2 pt-1">
                  <p className="text-[11px] lg:text-[12px] text-on-surface-variant leading-relaxed line-clamp-3">
                    {preview(p)}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
