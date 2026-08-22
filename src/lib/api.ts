const TOKEN_KEY = 'cc_token'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)

async function req(path: string, opts: RequestInit = {}) {
  const token = getToken()
  const headers: Record<string, string> = { ...(opts.headers as any) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(`/api${path}`, { ...opts, headers })
  if (!res.ok) {
    let d = res.statusText
    try { d = (await res.json()).detail || d } catch {}
    const err: any = new Error(d)
    err.status = res.status
    throw err
  }
  return res.status === 204 ? null : res.json()
}
const j = (b: any) => JSON.stringify(b)

export const api = {
  devLogin: (name: string) => req('/dev/token', { method: 'POST', body: j({ name }) }),
  me: () => req('/me'),
  updateProfile: (b: any) => req('/profile', { method: 'PUT', body: j(b) }),
  getUser: (h: string) => req(`/users/${h}`),
  getUserPosts: (h: string) => req(`/users/${h}/posts`),
  follow: (h: string) => req(`/follow/${h}`, { method: 'POST' }),
  unfollow: (h: string) => req(`/follow/${h}`, { method: 'DELETE' }),
  acceptFollow: (h: string) => req(`/follow-requests/${h}/accept`, { method: 'POST' }),
  followRequests: () => req('/follow-requests'),
  inviteInner: (h: string) => req(`/inner/invite/${h}`, { method: 'POST' }),
  acceptInner: (h: string) => req(`/inner/accept/${h}`, { method: 'POST' }),
  getInner: () => req('/inner'),
  feed: (scope: string) => req(`/feed?scope=${scope}`),
  createPost: (b: any) => req('/posts', { method: 'POST', body: j(b) }),
  deletePost: (id: string) => req(`/posts/${id}`, { method: 'DELETE' }),
  likePost: (id: string) => req(`/posts/${id}/like`, { method: 'POST' }),
  trending: () => req('/trending'),
  search: (q: string) => req(`/search?q=${encodeURIComponent(q)}`),
  dmThreads: () => req('/dms'),
  dmHistory: (h: string) => req(`/dms/${h}`),
  dmSend: (h: string, text: string) => req(`/dms/${h}`, { method: 'POST', body: j({ text }) }),
  activity: () => req('/activity'),
  livekitToken: (room: string) => req('/livekit/token', { method: 'POST', body: j({ room }) }),
  upload: (file: File) => { const fd = new FormData(); fd.append('file', file); return req('/upload', { method: 'POST', body: fd }) },
  report: (target_type: string, target_id: string, category: string, note = '') =>
    req('/report', { method: 'POST', body: j({ target_type, target_id, category, note }) }),
  adminStats: () => req('/admin/stats'),
  adminReports: (status = 'open') => req(`/admin/reports?status=${status}`),
  adminAction: (id: string, action: string, reason = '') => req(`/admin/reports/${id}/action`, { method: 'POST', body: j({ action, reason }) }),
  adminCsam: () => req('/admin/csam'),
  adminUsers: (q = '') => req(`/admin/users?q=${encodeURIComponent(q)}`),
  adminStrike: (handle: string, reason: string, stage?: string) => req(`/admin/users/${handle}/strike`, { method: 'POST', body: j({ reason, stage }) }),
  adminUnsuspend: (handle: string) => req(`/admin/users/${handle}/unsuspend`, { method: 'POST' }),
  adminAudit: () => req('/admin/audit'),
}

export function wsDmUrl(handle: string, token: string) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/ws/dm/${handle}?token=${encodeURIComponent(token)}`
}
