/** Small building blocks shared by the admin console sections. */
import type { ReactNode } from 'react'

export function AdminSection({ title, action, children, className = '' }: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="label-caps">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block label-caps mb-1.5">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-on-surface-variant/70">{hint}</span>}
    </label>
  )
}

/** Inline result of an action: an error, or a confirmation. */
export function Notice({ kind, children, onDismiss }: {
  kind: 'error' | 'ok'
  children: ReactNode
  onDismiss?: () => void
}) {
  const tone = kind === 'error'
    ? 'border-red-emergency/50 bg-red-emergency/10 text-red-300'
    : 'border-green-ais/40 bg-green-ais/10 text-green-ais'
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 border px-3 py-2 text-xs ${tone}`}>
      <span className="ms text-[16px] leading-none mt-px" aria-hidden="true">{kind === 'error' ? 'error' : 'check_circle'}</span>
      <div className="flex-1 min-w-0 break-words">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="ms text-[16px] leading-none opacity-70 hover:opacity-100">
          close
        </button>
      )}
    </div>
  )
}

/** Error text from a failed API response (FastAPI {"detail": ...}). */
export async function apiError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}))
  const d = (body as { detail?: unknown }).detail
  if (typeof d === 'string') return d
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg)
  return `Request failed (HTTP ${res.status})`
}

/** Show credentials embedded in a URL as ••• (user:key@host, ?key=…). */
export function maskUrl(url: string): string {
  return url
    .replace(/\/\/[^/@\s]+@/, '//•••@')
    .replace(/([?&](?:key|token|api_key|apikey|password|secret)=)[^&\s]+/gi, '$1•••')
}
