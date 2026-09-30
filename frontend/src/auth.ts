const PROFILE_KEY = 'vertex_auth_profile'

// Remove JWTs persisted by pre-hardening releases.
try { localStorage.removeItem('vertex_auth_token') } catch { /* storage unavailable */ }

type SessionProfile = { username: string; role: 'admin' | 'viewer' }

function decodeProfile(token: string): SessionProfile | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
    if (typeof payload.sub !== 'string') return null
    return { username: payload.sub, role: payload.role === 'admin' ? 'admin' : 'viewer' }
  } catch {
    return null
  }
}

function readProfile(): SessionProfile | null {
  try {
    const raw = sessionStorage.getItem(PROFILE_KEY)
    return raw ? JSON.parse(raw) as SessionProfile : null
  } catch {
    return null
  }
}

export function setSession(profile: SessionProfile): void {
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}

/**
 * Keep only non-secret display metadata in browser storage. The server also
 * sets the JWT as an HttpOnly SameSite cookie, so scripts and URLs never hold it.
 */
export function setToken(token: string): void {
  const profile = decodeProfile(token)
  if (profile) setSession(profile)
}

export function clearToken(): void {
  sessionStorage.removeItem(PROFILE_KEY)
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'X-Vertex-Request': '1' },
    })
  } finally {
    clearToken()
  }
}

export function authHeaders(): HeadersInit {
  return { 'X-Vertex-Request': '1' }
}

export function isLoggedIn(): boolean {
  return readProfile() !== null
}

export function getUserRole(): 'admin' | 'viewer' {
  return readProfile()?.role ?? 'viewer'
}

export function getUsername(): string {
  return readProfile()?.username ?? ''
}
