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

// ── Shared layout ─────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark h-screen w-screen flex items-center justify-center bg-onyx-black">
      <div className="w-full max-w-sm px-8 py-10 rounded-xl bg-surface/80 border border-white/10 backdrop-blur-sm shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-on-surface tracking-wide">Vertex</h1>
          <p className="mt-1 text-xs text-on-surface/50 uppercase tracking-widest">
            Situational Awareness
          </p>
        </div>
        {children}
      </div>
    </div>
  )
}

function FieldError({ msg }: { msg: string }) {
  return msg ? <p className="mt-1 text-xs text-red-400">{msg}</p> : null
}

// ── Setup view — create first admin account ───────────────────────────────────

function SetupView({ onDone }: { onDone: () => void }) {
  const [username, setUsername]     = useState('')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [submitted, setSubmitted]   = useState(false)
  const [serverError, setServerError] = useState('')
  const [loading, setLoading]       = useState(false)

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
      onDone()         // directly into the dashboard — no second login required
    } catch {
      setServerError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Shell>
      <p className="mb-6 text-xs text-on-surface/60 text-center leading-relaxed">
        No accounts exist yet. Create the admin account to get started.
      </p>

      <form onSubmit={submit} noValidate className="space-y-4">
        <div>
          <label className="block text-xs text-on-surface/60 mb-1" htmlFor="su-username">
            Username
          </label>
          <input
            id="su-username"
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full rounded-md bg-onyx-black/60 border border-white/10 px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
          <FieldError msg={usernameErr} />
        </div>

        <div>
          <label className="block text-xs text-on-surface/60 mb-1" htmlFor="su-password">
            Password
          </label>
          <input
            id="su-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full rounded-md bg-onyx-black/60 border border-white/10 px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
          <FieldError msg={passwordErr} />
        </div>

        <div>
          <label className="block text-xs text-on-surface/60 mb-1" htmlFor="su-confirm">
            Confirm password
          </label>
          <input
            id="su-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="w-full rounded-md bg-onyx-black/60 border border-white/10 px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
          <FieldError msg={confirmErr} />
        </div>

        {serverError && <p className="text-xs text-red-400">{serverError}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-brand-blue hover:bg-brand-blue/80 disabled:opacity-50 py-2 text-sm font-medium text-white transition-colors"
        >
          {loading ? 'Creating account…' : 'Create admin account'}
        </button>
      </form>
    </Shell>
  )
}

// ── Login view ────────────────────────────────────────────────────────────────

function LoginView({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername]       = useState('')
  const [password, setPassword]       = useState('')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)

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
        <div>
          <label className="block text-xs text-on-surface/60 mb-1" htmlFor="login-username">
            Username
          </label>
          <input
            id="login-username"
            type="text"
            autoComplete="username"
            autoFocus
            required
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full rounded-md bg-onyx-black/60 border border-white/10 px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

        <div>
          <label className="block text-xs text-on-surface/60 mb-1" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full rounded-md bg-onyx-black/60 border border-white/10 px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-brand-blue hover:bg-brand-blue/80 disabled:opacity-50 py-2 text-sm font-medium text-white transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign in'}
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
          // Setup returns a token, so the user is immediately authenticated
          onLogin()
        }}
      />
    )
  }

  return <LoginView onLogin={onLogin} />
}
