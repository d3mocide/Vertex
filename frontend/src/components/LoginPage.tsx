import { useState, FormEvent } from 'react'
import { API_BASE } from '../config'
import { setToken } from '../auth'

interface Props {
  onLogin: () => void
}

export function LoginPage({ onLogin }: Props) {
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

      if (!res.ok) {
        setError('Invalid username or password.')
        return
      }

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
    <div className="dark h-screen w-screen flex items-center justify-center bg-onyx-black">
      <div className="w-full max-w-sm px-8 py-10 rounded-xl bg-surface/80 border border-white/10 backdrop-blur-sm shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-on-surface tracking-wide">Vertex</h1>
          <p className="mt-1 text-xs text-on-surface/50 uppercase tracking-widest">Situational Awareness</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-on-surface/60 mb-1" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full rounded-md bg-onyx-black/60 border border-white/10 px-3 py-2 text-sm text-on-surface placeholder-on-surface/30 focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>

          <div>
            <label className="block text-xs text-on-surface/60 mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-md bg-onyx-black/60 border border-white/10 px-3 py-2 text-sm text-on-surface placeholder-on-surface/30 focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-brand-blue hover:bg-brand-blue/80 disabled:opacity-50 py-2 text-sm font-medium text-white transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
