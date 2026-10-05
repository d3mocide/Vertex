import React, { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '../config'
import { authHeaders, getUsername } from '../auth'
import { AdminSection, Notice, apiError } from './ui'

type UserDetail = {
  id: number
  username: string
  role: 'admin' | 'viewer'
  created_at: string
  last_login: string | null
  has_api_key: boolean
}
type Role = UserDetail['role']

const MIN_PASSWORD = 12   // backend CreateUserRequest / ResetPasswordRequest
const INACTIVE_DAYS = 30
// No look-alike characters (0/O, 1/l/I) so a generated password can be read out or typed from a screen.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

/** A random password from the browser's cryptographic generator. */
export function generatePassword(length = 20): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  // Rejection-free mapping is fine here: 54 symbols from a byte has a negligible bias for a password.
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('')
}

function absolute(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never signed in'
}

function relative(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Never'
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 86400 * 60) return `${Math.round(s / 86400)} d ago`
  return `${Math.round(s / (86400 * 30))} mo ago`
}

const daysSince = (iso: string | null, now = Date.now()) => (iso ? (now - new Date(iso).getTime()) / 86400000 : Infinity)

/** Password input with show/hide, a generator and copy, so admins are not left inventing one. */
function PasswordField({ value, onChange, label, id }: { value: string; onChange: (v: string) => void; label: string; id: string }) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <div className="stack-y-1.5">
      <div className="flex gap-2">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={MIN_PASSWORD}
          aria-label={label}
          placeholder={`${MIN_PASSWORD}+ characters`}
          className="tactical-input flex-1 min-w-0 font-mono"
        />
        <button type="button" className="btn-ghost shrink-0" onClick={() => { onChange(generatePassword()); setShown(true); setCopied(false) }}>
          Generate
        </button>
      </div>
      <div className="flex items-center gap-4 text-[11px] uppercase tracking-widest text-on-surface-variant">
        <button type="button" className="hover:text-amber-gold" onClick={() => setShown((v) => !v)}>{shown ? 'Hide' : 'Show'}</button>
        {value && (
          <button type="button" className="hover:text-amber-gold" onClick={async () => {
            try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard unavailable */ }
          }}>{copied ? 'Copied ✓' : 'Copy'}</button>
        )}
        <span className={`ml-auto normal-case tracking-normal ${value && value.length < MIN_PASSWORD ? 'text-amber-gold' : ''}`}>
          {value ? `${value.length} characters` : `At least ${MIN_PASSWORD} characters`}
        </span>
      </div>
    </div>
  )
}

function RoleBadge({ role }: { role: Role }) {
  return role === 'admin'
    ? <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-amber-gold border border-amber-gold/40 bg-amber-gold/5 px-1.5 py-0.5"><span className="ms text-[12px]" aria-hidden="true">shield_person</span>Admin</span>
    : <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-on-surface-variant border border-white/15 px-1.5 py-0.5"><span className="ms text-[12px]" aria-hidden="true">visibility</span>Viewer</span>
}

type MenuItem = { label: string; onSelect: () => void; danger?: boolean }

/** The per-account actions, kept out of the way until asked for. */
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="ms text-[20px] leading-none p-1.5 text-on-surface-variant hover:text-amber-gold hover:bg-white/5">
        more_horiz
      </button>
      {open && (
        <ul role="menu" className="absolute right-0 top-full mt-1 z-20 min-w-48 border border-white/15 bg-onyx-deep shadow-xl py-1">
          {items.map((it) => (
            <li key={it.label} role="none">
              <button type="button" role="menuitem"
                onClick={() => { setOpen(false); it.onSelect() }}
                className={`w-full text-left px-3 py-2 text-[12px] hover:bg-white/5 ${it.danger ? 'text-red-emergency hover:text-red-400' : 'text-on-surface'}`}>
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
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

  const [showCreate, setShowCreate] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<Role>('viewer')
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

  const changeRole = (u: UserDetail, role: Role) =>
    act(() => fetch(`${API_BASE}/auth/users/${u.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ role }) }),
        `${u.username} is now ${role === 'admin' ? 'an admin' : 'a viewer'}.`)

  const deleteUser = (u: UserDetail) => {
    if (!confirm(`Delete "${u.username}"? This cannot be undone.`)) return
    act(() => fetch(`${API_BASE}/auth/users/${u.id}`, { method: 'DELETE', headers: authHeaders() }), `Deleted ${u.username}.`)
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
    act(() => fetch(`${API_BASE}/auth/users/${u.id}/apikey`, { method: 'DELETE', headers: authHeaders() }), `Revoked ${u.username}'s API key.`)
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
    if (res) { setNewUsername(''); setNewPassword(''); setNewRole('viewer'); setShowCreate(false) }
    setCreating(false)
  }

  // Admins first, then by most recent sign-in.
  const sorted = [...users].sort((a, b) =>
    (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1) ||
    (new Date(b.last_login ?? 0).getTime() - new Date(a.last_login ?? 0).getTime()))
  const admins = users.filter((u) => u.role === 'admin').length
  const clients = users.filter((u) => u.has_api_key).length
  const lastSignIn = users.map((u) => u.last_login).filter(Boolean).sort().slice(-1)[0] ?? null

  return (
    <div className="max-w-4xl stack-y-6">
      {notice && <Notice kind={notice.kind} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}

      {issuedKey && (
        <div className="border border-amber-gold/50 bg-amber-gold/5 p-4 stack-y-2">
          <div className="label-caps text-amber-gold">API key for {issuedKey.username} — copy it now</div>
          <p className="text-[11px] text-on-surface-variant">It is shown only once. Send it as the <span className="font-mono">X-API-Key</span> header.</p>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 min-w-0 font-mono text-[11px] text-on-surface bg-black/60 border border-white/10 px-2 py-2 break-all select-all">
              {issuedKey.key}
            </code>
            <button type="button" className="btn-ghost shrink-0" onClick={() => navigator.clipboard?.writeText(issuedKey.key)}>Copy</button>
          </div>
          <button type="button" className="text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface" onClick={() => setIssuedKey(null)}>Done</button>
        </div>
      )}

      <AdminSection
        title="Accounts"
        action={
          <button type="button" className={showCreate ? 'btn-ghost' : 'btn-primary'} onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Cancel' : '+ New account'}
          </button>
        }
      >
        {showCreate && (
          <form onSubmit={createUser} className="border border-amber-gold/30 bg-surface-container p-4 mb-4 stack-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="block label-caps mb-1.5">Username</span>
                <input
                  type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
                  required minLength={3} maxLength={64} pattern="^[a-zA-Z0-9_\-]+$"
                  autoCapitalize="none" autoCorrect="off" autoComplete="off"
                  className="tactical-input" placeholder="letters, numbers, - and _"
                />
              </label>
              <div>
                <span className="block label-caps mb-1.5">Role</span>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Role">
                  {(['viewer', 'admin'] as Role[]).map((r) => (
                    <button key={r} type="button" role="radio" aria-checked={newRole === r} onClick={() => setNewRole(r)}
                      className={`px-3 py-2 text-left border text-[12px] ${newRole === r ? 'border-amber-gold bg-amber-gold/10 text-on-surface' : 'border-white/10 text-on-surface-variant hover:border-white/30'}`}>
                      <span className="block font-bold uppercase tracking-widest text-[11px]">{r}</span>
                      <span className="block text-[11px] mt-0.5">{r === 'viewer' ? 'Sees everything, cannot change settings' : 'Full access, including this console'}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <span className="block label-caps mb-1.5">Password</span>
              <PasswordField id="new-account-password" label="Password for the new account" value={newPassword} onChange={setNewPassword} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" disabled={creating} className="btn-primary disabled:opacity-50">{creating ? 'Creating…' : 'Create account'}</button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="text-xs text-on-surface-variant">Loading…</p>
        ) : loadError ? (
          <Notice kind="error">Couldn't load accounts: {loadError}</Notice>
        ) : (
          <>
            <p className="mb-3 text-[12px] font-mono text-on-surface-variant">
              <span className="text-on-surface font-bold">{users.length}</span> account{users.length !== 1 ? 's' : ''}
              {' · '}<span className="text-on-surface font-bold">{admins}</span> admin{admins !== 1 ? 's' : ''}
              {clients > 0 && <>{' · '}<span className="text-on-surface font-bold">{clients}</span> with an API key</>}
              {lastSignIn && <>{' · '}last sign-in {relative(lastSignIn)}</>}
            </p>

            <div className="border border-white/10 bg-black/30 divide-y divide-white/5">
              {sorted.map((u) => {
                const isMe = u.username === me
                const inactive = !u.has_api_key && daysSince(u.last_login) >= INACTIVE_DAYS
                const items: MenuItem[] = [
                  { label: 'Set password…', onSelect: () => { setResetFor(resetFor === u.id ? null : u.id); setResetPassword('') } },
                  { label: u.has_api_key ? 'Replace API key' : 'Issue API key', onSelect: () => issueKey(u) },
                  ...(u.has_api_key ? [{ label: 'Revoke API key', onSelect: () => revokeKey(u) }] : []),
                  ...(!isMe ? [{ label: u.role === 'admin' ? 'Make viewer' : 'Make admin', onSelect: () => changeRole(u, u.role === 'admin' ? 'viewer' : 'admin') }] : []),
                  ...(!isMe ? [{ label: 'Delete account…', danger: true, onSelect: () => deleteUser(u) }] : []),
                ]
                return (
                  <div key={u.id}>
                    <div className="flex items-center gap-3 px-3 py-3">
                      <span className={`ms text-[22px] shrink-0 ${u.role === 'admin' ? 'text-amber-gold' : 'text-on-surface-variant'}`} aria-hidden="true">
                        {u.has_api_key && u.role === 'viewer' ? 'smart_toy' : u.role === 'admin' ? 'shield_person' : 'person'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm text-on-surface truncate">{u.username}</span>
                          {isMe && <span className="text-[10px] uppercase tracking-widest text-green-ais border border-green-ais/40 px-1">You</span>}
                          {u.has_api_key && <span className="text-[10px] uppercase tracking-widest text-on-surface-variant border border-white/15 px-1">API key</span>}
                        </div>
                        <div className="text-[11px] text-on-surface-variant mt-0.5">
                          Created {new Date(u.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                        </div>
                      </div>
                      <div className="hidden sm:block w-36 text-right">
                        <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Last sign-in</div>
                        <div className={`font-mono text-[12px] ${inactive ? 'text-amber-gold' : 'text-on-surface'}`} title={absolute(u.last_login)}>
                          {relative(u.last_login)}
                        </div>
                        {inactive && <div className="text-[10px] text-amber-gold">inactive</div>}
                      </div>
                      <div className="shrink-0"><RoleBadge role={u.role} /></div>
                      <RowMenu label={`Actions for ${u.username}`} items={items} />
                    </div>
                    <div className="sm:hidden px-3 pb-2 -mt-1 text-[11px] text-on-surface-variant font-mono" title={absolute(u.last_login)}>
                      Last sign-in {relative(u.last_login)}{inactive && <span className="text-amber-gold"> · inactive</span>}
                    </div>

                    {resetFor === u.id && (
                      <form onSubmit={(e) => submitReset(e, u)} className="px-3 pb-3 stack-y-2 border-t border-white/5 pt-3 bg-white/2">
                        <div className="label-caps">New password for {u.username}</div>
                        <PasswordField id={`reset-${u.id}`} label={`New password for ${u.username}`} value={resetPassword} onChange={setResetPassword} />
                        <div className="flex justify-end gap-2">
                          <button type="button" className="btn-ghost" onClick={() => { setResetFor(null); setResetPassword('') }}>Cancel</button>
                          <button type="submit" className="btn-primary">Save password</button>
                        </div>
                      </form>
                    )}
                  </div>
                )
              })}
              {users.length === 0 && <div className="px-3 py-3 text-xs text-on-surface-variant">No accounts.</div>}
            </div>
          </>
        )}
      </AdminSection>
    </div>
  )
}
