import React, { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../config'
import { authHeaders, getUsername } from '../auth'
import { AdminSection, Field, Notice, apiError } from './ui'

type UserDetail = {
  id: number
  username: string
  role: 'admin' | 'viewer'
  created_at: string
  last_login: string | null
  has_api_key: boolean
}

const MIN_PASSWORD = 12   // backend CreateUserRequest / ResetPasswordRequest

function fmt(iso: string | null) {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AdminUsers() {
  const me = getUsername()
  const [users, setUsers] = useState<UserDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  // A freshly issued API key: shown once, then gone.
  const [issuedKey, setIssuedKey] = useState<{ username: string; key: string } | null>(null)
  const [resetFor, setResetFor] = useState<number | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'viewer'>('viewer')
  const [creating, setCreating] = useState(false)

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/users`, { headers: authHeaders() })
      if (!res.ok) throw new Error(await apiError(res))
      setUsers(await res.json())
      setLoadError('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  // Run an admin action, report its outcome, refresh the list.
  const act = async (req: () => Promise<Response>, ok: string) => {
    setNotice(null)
    try {
      const res = await req()
      if (!res.ok) throw new Error(await apiError(res))
      setNotice({ kind: 'ok', text: ok })
      await loadUsers()
      return res
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
      return null
    }
  }

  const json = { 'Content-Type': 'application/json', ...authHeaders() }

  const changeRole = (u: UserDetail, role: 'admin' | 'viewer') =>
    act(() => fetch(`${API_BASE}/auth/users/${u.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ role }) }),
        `${u.username} is now ${role === 'admin' ? 'an admin' : 'a viewer'}.`)

  const deleteUser = (u: UserDetail) => {
    if (!confirm(`Delete "${u.username}"? This cannot be undone.`)) return
    act(() => fetch(`${API_BASE}/auth/users/${u.id}`, { method: 'DELETE', headers: authHeaders() }),
        `Deleted ${u.username}.`)
  }

  const issueKey = async (u: UserDetail) => {
    if (u.has_api_key && !confirm(`Replace ${u.username}'s API key? Anything using the old key stops working.`)) return
    setIssuedKey(null)
    const res = await act(() => fetch(`${API_BASE}/auth/users/${u.id}/apikey`, { method: 'POST', headers: authHeaders() }),
                          `New API key issued for ${u.username}.`)
    if (res) setIssuedKey({ username: u.username, key: (await res.json()).api_key })
  }

  const revokeKey = (u: UserDetail) => {
    if (!confirm(`Revoke ${u.username}'s API key? Anything using it stops working.`)) return
    act(() => fetch(`${API_BASE}/auth/users/${u.id}/apikey`, { method: 'DELETE', headers: authHeaders() }),
        `Revoked ${u.username}'s API key.`)
  }

  const submitReset = async (e: React.FormEvent, u: UserDetail) => {
    e.preventDefault()
    const res = await act(() => fetch(`${API_BASE}/auth/users/${u.id}/password`, {
      method: 'POST', headers: json, body: JSON.stringify({ password: resetPassword }),
    }), `Password changed for ${u.username}.`)
    if (res) { setResetFor(null); setResetPassword('') }
  }

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    const res = await act(() => fetch(`${API_BASE}/auth/users`, {
      method: 'POST', headers: json, body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
    }), `Created ${newUsername}.`)
    if (res) { setNewUsername(''); setNewPassword(''); setNewRole('viewer') }
    setCreating(false)
  }

  return (
    <div className="max-w-3xl space-y-8">
      {notice && <Notice kind={notice.kind} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}

      {issuedKey && (
        <div className="border border-amber-gold/50 bg-amber-gold/5 p-4 space-y-2">
          <div className="label-caps text-amber-gold">API key for {issuedKey.username} — copy it now</div>
          <p className="text-[11px] text-on-surface-variant">It is shown only once. Send it as the <span className="font-mono">X-API-Key</span> header.</p>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 min-w-0 font-mono text-[11px] text-on-surface bg-black/60 border border-white/10 px-2 py-2 break-all select-all">
              {issuedKey.key}
            </code>
            <button type="button" className="btn-ghost shrink-0" onClick={() => navigator.clipboard?.writeText(issuedKey.key)}>
              Copy
            </button>
          </div>
          <button type="button" className="text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface" onClick={() => setIssuedKey(null)}>
            Done
          </button>
        </div>
      )}

      <AdminSection title={`Accounts${users.length ? ` · ${users.length}` : ''}`}>
        {loading ? (
          <p className="text-xs text-on-surface-variant">Loading…</p>
        ) : loadError ? (
          <Notice kind="error">Couldn't load accounts: {loadError}</Notice>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => {
              const isMe = u.username === me
              return (
                <li key={u.id} className="border border-white/10 bg-surface-container">
                  <div className="flex items-center gap-3 px-3 py-3">
                    <span className={`ms text-[20px] ${u.role === 'admin' ? 'text-amber-gold' : 'text-on-surface-variant'}`} aria-hidden="true">
                      {u.role === 'admin' ? 'shield_person' : 'person'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-on-surface truncate">{u.username}</span>
                        {isMe && <span className="text-[10px] uppercase tracking-widest text-green-ais border border-green-ais/40 px-1">You</span>}
                        {u.has_api_key && <span className="text-[10px] uppercase tracking-widest text-on-surface-variant border border-white/15 px-1">API key</span>}
                      </div>
                      <div className="text-[11px] text-on-surface-variant mt-0.5">
                        Last sign-in <span className="font-mono">{fmt(u.last_login)}</span>
                      </div>
                    </div>
                    <select
                      value={u.role}
                      disabled={isMe}
                      title={isMe ? "You can't change your own role" : 'Role'}
                      aria-label={`Role for ${u.username}`}
                      onChange={(e) => changeRole(u, e.target.value as 'admin' | 'viewer')}
                      className={`tactical-select shrink-0 disabled:opacity-50 ${u.role === 'admin' ? 'border-amber-gold/40 text-amber-gold' : ''}`}
                    >
                      <option value="admin">Admin</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 border-t border-white/5 text-[11px] uppercase tracking-widest">
                    <button type="button" className="text-on-surface-variant hover:text-amber-gold" onClick={() => issueKey(u)}>
                      {u.has_api_key ? 'Replace API key' : 'Issue API key'}
                    </button>
                    {u.has_api_key && (
                      <button type="button" className="text-on-surface-variant hover:text-amber-gold" onClick={() => revokeKey(u)}>
                        Revoke key
                      </button>
                    )}
                    <button type="button" className="text-on-surface-variant hover:text-amber-gold"
                            onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setResetPassword('') }}>
                      Set password
                    </button>
                    {!isMe && (
                      <button type="button" className="ml-auto text-red-emergency/80 hover:text-red-400" onClick={() => deleteUser(u)}>
                        Delete
                      </button>
                    )}
                  </div>

                  {resetFor === u.id && (
                    <form onSubmit={(e) => submitReset(e, u)} className="flex flex-col sm:flex-row gap-2 px-3 pb-3">
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        minLength={MIN_PASSWORD}
                        required
                        placeholder={`New password (${MIN_PASSWORD}+ characters)`}
                        aria-label={`New password for ${u.username}`}
                        className="tactical-input flex-1"
                      />
                      <button type="submit" className="btn-ghost">Save</button>
                    </form>
                  )}
                </li>
              )
            })}
            {users.length === 0 && <li className="text-xs text-on-surface-variant">No accounts.</li>}
          </ul>
        )}
      </AdminSection>

      <AdminSection title="Create account">
        <form onSubmit={createUser} className="border border-white/10 bg-surface-container p-4 space-y-4 sm:max-w-sm">
          <Field label="Username" hint="Letters, numbers, - and _.">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              required
              minLength={3}
              maxLength={64}
              pattern="^[a-zA-Z0-9_\-]+$"
              autoCapitalize="none"
              autoCorrect="off"
              className="tactical-input"
            />
          </Field>
          <Field label="Password" hint={`At least ${MIN_PASSWORD} characters.`}>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD}
              className="tactical-input"
            />
          </Field>
          <Field label="Role" hint="Viewers can see everything; only admins can change settings.">
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'viewer')} className="tactical-select w-full">
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <button type="submit" disabled={creating} className="btn-primary w-full disabled:opacity-50">
            {creating ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </AdminSection>
    </div>
  )
}
