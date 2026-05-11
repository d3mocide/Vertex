import React, { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

type UserDetail = {
  id: number
  username: string
  role: string
  created_at: string
  last_login: string | null
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'viewer'>('viewer')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/users`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`${res.status}`)
      setUsers(await res.json())
      setError('')
    } catch (e) {
      setError(`Failed to load users: ${e}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const changeRole = async (user: UserDetail, role: 'admin' | 'viewer') => {
    const res = await fetch(`${API_BASE}/auth/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ role }),
    })
    if (res.ok) await loadUsers()
  }

  const deleteUser = async (user: UserDetail) => {
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return
    const res = await fetch(`${API_BASE}/auth/users/${user.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    if (res.ok || res.status === 204) await loadUsers()
  }

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setCreateError('')
    try {
      const res = await fetch(`${API_BASE}/auth/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `HTTP ${res.status}`)
      }
      setNewUsername('')
      setNewPassword('')
      setNewRole('viewer')
      await loadUsers()
    } catch (e) {
      setCreateError(String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="max-w-5xl space-y-8">
        {/* User table */}
        <section>
          <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Accounts</h2>
          {loading ? (
            <p className="text-xs text-gray-500">Loading…</p>
          ) : error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : (
            <div className="border border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-surface-container">
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-normal">Username</th>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-normal">Role</th>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-normal">Created</th>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-normal">Last Login</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-3 py-2 font-mono text-gray-200">{u.username}</td>
                      <td className="px-3 py-2">
                        <select
                          value={u.role}
                          onChange={(e) => changeRole(u, e.target.value as 'admin' | 'viewer')}
                          className={`tactical-select pl-1.5 py-0.5 h-auto ${
                          u.role === 'admin'
                            ? 'border-amber-gold/40 text-amber-gold'
                            : 'border-white/20 text-on-surface-variant'
                        }`}
                        >
                          <option value="admin">admin</option>
                          <option value="viewer">viewer</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-[10px]">{fmt(u.created_at)}</td>
                      <td className="px-3 py-2 text-gray-500 text-[10px]">{fmt(u.last_login)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => deleteUser(u)}
                          className="text-[10px] text-red-500/60 hover:text-red-400 transition-colors uppercase tracking-wider"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-gray-600 text-xs">
                        No users
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Create user form */}
        <section>
          <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Create Account</h2>
          <form onSubmit={createUser} className="border border-white/10 bg-black/30 p-4 space-y-3 max-w-sm">
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Username</label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
                minLength={3}
                maxLength={64}
                pattern="^[a-zA-Z0-9_-]+$"
                placeholder="username"
                className="w-full bg-black/60 border border-white/10 text-gray-200 text-xs px-3 py-1.5 focus:outline-none focus:border-amber-gold/60"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                placeholder="min. 8 characters"
                className="w-full bg-black/60 border border-white/10 text-gray-200 text-xs px-3 py-1.5 focus:outline-none focus:border-amber-gold/60"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'admin' | 'viewer')}
                className="tactical-select w-full"
              >
                <option value="viewer">viewer</option>
                <option value="admin">admin</option>
              </select>
            </div>
            {createError && <p className="text-xs text-red-400">{createError}</p>}
            <button
              type="submit"
              disabled={creating}
              className="w-full py-1.5 text-[10px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create User'}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
