import { useState, FormEvent } from 'react'
import { API_BASE } from '../config'
import { setToken } from '../auth'

interface Props {
  onLogin: () => void
}

type View = 'login' | 'setup'

// ── Field validation ──────────────────────────────────────────────────────────

function validateUsername(v: string): string {
  if (v.length < 3) return 'At least 3 characters required.'
  if (v.length > 64) return 'Maximum 64 characters.'
  if (!/^[a-zA-Z0-9_-]+$/.test(v)) return 'Letters, numbers, _ and - only.'
  return ''
}

function validatePassword(v: string): string {
  if (v.length < 8) return 'At least 8 characters required.'
  return ''
}

// ── Scope logo mark ───────────────────────────────────────────────────────────

function ScopeMark({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="text-white">
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

// ── Shared layout ─────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-screen w-screen flex items-center justify-center bg-onyx-black"
      style={{
        backgroundImage: [
          'linear-gradient(180deg, rgba(255,184,0,0.018) 0%, transparent 50%, rgba(0,0,0,0.4) 100%)',
          'repeating-linear-gradient(0deg, transparent 0px, transparent 39px, rgba(255,255,255,0.012) 40px)',
          'repeating-linear-gradient(90deg, transparent 0px, transparent 39px, rgba(255,255,255,0.012) 40px)',
        ].join(', '),
      }}
    >
      {/* HUD panel */}
      <div className="w-full max-w-sm relative hud-panel border border-amber-gold/20">
        {/* Corner brackets */}
        <span className="absolute top-2 left-2 w-4 h-4 border-t border-l border-amber-gold pointer-events-none" aria-hidden="true" />
        <span className="absolute top-2 right-2 w-4 h-4 border-t border-r border-amber-gold pointer-events-none" aria-hidden="true" />
        <span className="absolute bottom-2 left-2 w-4 h-4 border-b border-l border-amber-gold pointer-events-none" aria-hidden="true" />
        <span className="absolute bottom-2 right-2 w-4 h-4 border-b border-r border-amber-gold pointer-events-none" aria-hidden="true" />

        {/* Panel header — brand lockup B (stacked) */}
        <div className="flex flex-col items-center gap-3 px-8 pt-10 pb-6 border-b border-amber-gold-muted">
          <ScopeMark size={56} />
          <div className="flex flex-col items-center gap-1 leading-none">
            <span className="text-[22px] font-black tracking-[0.08em] text-white uppercase select-none">
              VERTEX
            </span>
            <span className="font-mono text-[9px] tracking-[0.25em] text-amber-gold uppercase">
              SITUATIONAL AWARENESS
            </span>
          </div>
        </div>

        {/* Form body */}
        <div className="px-8 py-7">
          {children}
        </div>

        {/* Panel footer */}
        <div className="px-8 pb-6 flex items-center justify-between">
          <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-on-surface-variant">
            SECURE CHANNEL
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.18em] uppercase text-green-ais">
            <span
              className="w-1.5 h-1.5 rounded-full bg-green-ais"
              style={{ boxShadow: '0 0 6px #00C853', animation: 'pulse-dot 1.6s ease-in-out infinite' }}
              aria-hidden="true"
            />
            SYSTEM NOMINAL
          </span>
        </div>
      </div>
    </div>
  )
}

function FieldError({ msg }: { msg: string }) {
  return msg
    ? <p className="mt-1.5 font-mono text-[10px] tracking-wider text-red-emergency uppercase">{msg}</p>
    : null
}

function Field({
  id, label, type, value, onChange, autoFocus, autoComplete,
}: {
  id: string
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
  autoComplete?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="label-caps"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
        value={value}
        onChange={e => onChange(e.target.value)}
        className={[
          'w-full bg-onyx-black border border-outline-variant',
          'font-mono text-[12px] text-on-surface px-3 py-2.5',
          'outline-none transition-[border-color,box-shadow] duration-150',
          'focus:border-amber-gold focus:[box-shadow:0_0_8px_rgba(255,184,0,0.4)]',
        ].join(' ')}
      />
    </div>
  )
}

// ── Setup view — create first admin account ───────────────────────────────────

function SetupView({ onDone }: { onDone: () => void }) {
  const [username, setUsername]       = useState('')
  const [password, setPassword]       = useState('')
  const [confirm, setConfirm]         = useState('')
  const [submitted, setSubmitted]     = useState(false)
  const [serverError, setServerError] = useState('')
  const [loading, setLoading]         = useState(false)

  const usernameErr = submitted ? validateUsername(username) : ''
  const passwordErr = submitted ? validatePassword(password) : ''
  const confirmErr  = submitted && password !== confirm ? 'Passwords do not match.' : ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setServerError('')
    if (validateUsername(username) || validatePassword(password) || password !== confirm) return

    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (res.status === 409) {
        setServerError('Setup is already complete. Please sign in.')
        onDone()
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setServerError((body as { detail?: string }).detail ?? 'Setup failed.')
        return
      }
      const { access_token } = await res.json() as { access_token: string }
      setToken(access_token)
      onDone()
    } catch {
      setServerError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Shell>
      <p className="mb-5 font-mono text-[10px] tracking-wider text-on-surface-variant uppercase leading-relaxed border-l border-amber-gold pl-3">
        No accounts exist yet. Create the admin account to get started.
      </p>

      <form onSubmit={submit} noValidate className="space-y-4">
        <div>
          <Field id="su-username" label="Username" type="text" autoComplete="username" autoFocus value={username} onChange={setUsername} />
          <FieldError msg={usernameErr} />
        </div>
        <div>
          <Field id="su-password" label="Password" type="password" autoComplete="new-password" value={password} onChange={setPassword} />
          <FieldError msg={passwordErr} />
        </div>
        <div>
          <Field id="su-confirm" label="Confirm Password" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} />
          <FieldError msg={confirmErr} />
        </div>

        {serverError && (
          <p className="font-mono text-[10px] tracking-wider text-red-emergency uppercase">{serverError}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full mt-2 disabled:opacity-50"
        >
          {loading ? 'CREATING ACCOUNT…' : 'CREATE ADMIN ACCOUNT'}
        </button>
      </form>
    </Shell>
  )
}

// ── Login view ────────────────────────────────────────────────────────────────

function LoginView({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const body = new URLSearchParams({ username, password })
      const res = await fetch(`${API_BASE}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      if (res.status === 401) { setError('Incorrect username or password.'); return }
      if (!res.ok) { setError('Sign-in failed. Please try again.'); return }

      const { access_token } = await res.json() as { access_token: string }
      setToken(access_token)
      onLogin()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4">
        <Field id="login-username" label="Username" type="text" autoComplete="username" autoFocus value={username} onChange={setUsername} />
        <Field id="login-password" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />

        {error && (
          <p className="font-mono text-[10px] tracking-wider text-red-emergency uppercase">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full mt-2 disabled:opacity-50"
        >
          {loading ? 'AUTHENTICATING…' : 'SIGN IN'}
        </button>
      </form>
    </Shell>
  )
}

// ── Exported component — decides which view to show ───────────────────────────

export function LoginPage({ onLogin, setupRequired }: Props & { setupRequired: boolean }) {
  const [view, setView] = useState<View>(setupRequired ? 'setup' : 'login')

  if (view === 'setup') {
    return (
      <SetupView
        onDone={() => {
          setView('login')
          onLogin()
        }}
      />
    )
  }

  return <LoginView onLogin={onLogin} />
}
