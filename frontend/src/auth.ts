const KEY = 'vertex_auth_token'

export function getToken(): string | null {
  return localStorage.getItem(KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(KEY)
}

export function authHeaders(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function wsTokenParam(): string {
  const token = getToken()
  return token ? `?token=${encodeURIComponent(token)}` : ''
}

// Returns true if a token exists (doesn't validate expiry — server will 401 if expired).
export function isLoggedIn(): boolean {
  return Boolean(getToken())
}

/** Decode the JWT payload and return the user's role. Returns 'viewer' when no token or on any error. */
export function getUserRole(): 'admin' | 'viewer' {
  const token = getToken()
  if (!token) return 'viewer'
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return 'viewer'
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.role === 'admin' ? 'admin' : 'viewer'
  } catch {
    return 'viewer'
  }
}
