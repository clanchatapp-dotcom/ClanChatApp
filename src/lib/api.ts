import { Capacitor } from '@capacitor/core'

const TOKEN_KEY = 'cc_token'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)

// Deployed FastAPI backend on Render. Used as the fallback inside the native app
// (which has no same-origin API) so the APK works out of the box even if the
// REACT_APP_API_URL build var isn't provided.
const NATIVE_API_FALLBACK = 'https://clanchatapp-backend.onrender.com'

// Resolve the backend base URL:
//  - If REACT_APP_API_URL is baked at build time, always use it (web deploy + APK).
//  - Else, inside the native Capacitor shell -> use the deployed Render backend.
//  - Else (sandbox dev / same-origin web) -> "" so requests hit relative "/api"
//    (Vite proxy in dev, same origin in single-host deploys).
function computeApiBase(): string {
  const fromEnv = (((import.meta as any).env.REACT_APP_API_URL || '') as string).replace(/\/$/, '')
  if (fromEnv) return fromEnv
  try { if (Capacitor.isNativePlatform()) return NATIVE_API_FALLBACK } catch { /* not native */ }
  return ''
}

export const API_BASE = computeApiBase()

async function req(path: string, opts: RequestInit = {}) {
  const token = getToken()
  const headers: Record<string, string> = { ...(opts.headers as any) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_BASE}/api${path}`, { ...opts, headers })
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
  authRegister: (email: string, password: string, name: string) => req('/auth/register', { method: 'POST', body: j({ email, password, name }) }),
  authLogin: (email: string, password: string) => req('/auth/login', { method: 'POST', body: j({ email, password }) }),
  me: () => req('/me'),
  updateProfile: (b: any) => req('/profile', { method: 'PUT', body: j(b) }),
  deleteAccount: () => req('/account', { method: 'DELETE' }),
  changePassword: (current_password: string, new_password: string) => req('/auth/change-password', { method: 'POST', body: j({ current_password, new_password }) }),
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
  adminFlag: (handle: string, reason: string) => req(`/admin/users/${handle}/flag`, { method: 'POST', body: j({ reason }) }),
  adminUnflag: (handle: string) => req(`/admin/users/${handle}/unflag`, { method: 'POST' }),
  adminUserDms: (handle: string) => req(`/admin/dms/${handle}`),
  adminAudit: () => req('/admin/audit'),
  adminPromote: (email: string) => req('/admin/promote', { method: 'POST', body: j({ email }) }),
  adminPurgeDemo: (include_admin: boolean) => req('/admin/purge-demo', { method: 'POST', body: j({ include_admin }) }),
  adminListAdmins: () => req('/admin/admins'),
  adminAddAdmin: (email: string) => req('/admin/admins', { method: 'POST', body: j({ email }) }),
  adminRemoveAdmin: (email: string) => req('/admin/admins/remove', { method: 'POST', body: j({ email }) }),
}

export function wsDmUrl(handle: string, token: string) {
  let host = window.location.host
  let secure = window.location.protocol === 'https:'
  if (API_BASE) { try { const u = new URL(API_BASE); host = u.host; secure = u.protocol === 'https:' } catch {} }
  const proto = secure ? 'wss' : 'ws'
  return `${proto}://${host}/api/ws/dm/${handle}?token=${encodeURIComponent(token)}`
}
