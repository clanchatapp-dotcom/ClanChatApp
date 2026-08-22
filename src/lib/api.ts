const TOKEN_KEY = 'cc_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

async function req(path: string, opts: RequestInit = {}) {
  const token = getToken()
  const headers: Record<string, string> = { ...(opts.headers as any) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`/api${path}`, { ...opts, headers })
  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).detail || detail } catch {}
    throw new Error(detail)
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  devLogin: (name: string) =>
    req('/dev/token', { method: 'POST', body: JSON.stringify({ name }) }),
  me: () => req('/me'),
  listClans: () => req('/clans'),
  createClan: (name: string, description = '') =>
    req('/clans', { method: 'POST', body: JSON.stringify({ name, description }) }),
  joinByCode: (code: string) =>
    req('/clans/join', { method: 'POST', body: JSON.stringify({ code }) }),
  getMessages: (clanId: string) => req(`/clans/${clanId}/messages`),
  sendMessage: (clanId: string, text: string, media_url?: string) =>
    req(`/clans/${clanId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, media_url }),
    }),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req('/upload', { method: 'POST', body: fd })
  },
}

export function wsUrl(clanId: string, token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/ws/${clanId}?token=${encodeURIComponent(token)}`
}
