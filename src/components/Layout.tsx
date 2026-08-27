import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { Home, Search, MessageCircle, Bell, User, LogOut, Sparkles, PenSquare, Shield, Settings, Film, Users2, Users } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { api, getToken, wsUserUrl } from '../lib/api'
import { Avatar } from '../lib/ui'
import OnboardingTour from './OnboardingTour'
import CallModal from './CallModal'
import IncomingCallScreen, { IncomingCall } from './IncomingCallScreen'
import RoleBadge from './RoleBadge'
import AccountBadge from './AccountBadge'

const NAV = [
  { to: '/', icon: Home, label: 'Feed', end: true },
  { to: '/search', icon: Search, label: 'Discover' },
  { to: '/messages', icon: MessageCircle, label: 'Messages' },
  { to: '/activity', icon: Bell, label: 'Activity' },
]

export default function Layout() {
  const { user, logout, refresh } = useAuth()
  const nav = useNavigate()
  const [trending, setTrending] = useState<any[]>([])
  const [unread, setUnread] = useState(0)
  const [dob, setDob] = useState('')
  const [dobBusy, setDobBusy] = useState(false)
  const [dobErr, setDobErr] = useState('')
  const needsDob = (user as any)?.dob_set === false
  const needsOnboarding = !needsDob && (user as any)?.onboarded === false
  const saveDob = async () => {
    setDobErr(''); setDobBusy(true)
    try { await api.setDob(dob); await refresh() }
    catch (e: any) { setDobErr(e.message || 'Please enter a valid date of birth') }
    setDobBusy(false)
  }
  useEffect(() => { api.trending().then(setTrending).catch(() => {}) }, [])
  useEffect(() => {
    const tick = () => api.unread().then((u: any) => setUnread(u?.total || 0)).catch(() => {})
    tick(); const id = setInterval(tick, 20000)
    return () => clearInterval(id)
  }, [])

  // Incoming-call ringing: app-wide personal WebSocket channel.
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  const [activeCall, setActiveCall] = useState<{ room: string; peer?: string } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  useEffect(() => {
    if (!user) return
    let stop = false
    const connect = () => {
      const t = getToken(); if (!t || stop) return
      let ws: WebSocket
      try { ws = new WebSocket(wsUserUrl(t)) } catch { return }
      wsRef.current = ws
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data)
          if (m.type === 'incoming_call') {
            setActiveCall(cur => { if (cur) return cur; setIncoming({ room: m.room, media: m.media || 'video', from: m.from }); return cur })
          } else if (m.type === 'call_cancelled') {
            setIncoming(cur => (cur && cur.room === m.room ? null : cur))
          }
        } catch { /* ignore */ }
      }
      ws.onclose = () => { if (!stop) setTimeout(connect, 2000) }
      ws.onerror = () => { try { ws.close() } catch {} }
    }
    connect()
    return () => { stop = true; try { wsRef.current?.close() } catch {} }
  }, [user?.id])

  const acceptCall = async () => {
    if (!incoming) return
    const c = incoming
    setIncoming(null)
    try { await api.callAccept(c.from.handle, c.room) } catch {}
    setActiveCall({ room: c.room })
    nav('/messages')
  }
  const declineCall = async () => {
    if (!incoming) return
    const c = incoming
    setIncoming(null)
    try { await api.callDecline(c.from.handle, c.room) } catch {}
  }

  const linkCls = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition ${active ? 'bg-brand/15 text-white border border-brand/30' : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'}`

  return (
    <div className="min-h-full w-full max-w-7xl mx-auto flex overflow-x-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 h-screen sticky top-0 p-4 gap-1">
        <div className="flex items-center gap-2 px-2 py-3">
          <img src="/logo.png" alt="ClanChat" className="h-9 w-9 object-contain" />
          <span className="font-extrabold text-lg">ClanChat</span>
        </div>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end as any} className={({ isActive }) => linkCls(isActive)}>
            <n.icon className="h-5 w-5" />{n.label}
            {n.to === '/messages' && unread > 0 && <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-xs grid place-items-center font-bold">{unread > 99 ? '99+' : unread}</span>}
          </NavLink>
        ))}
        <NavLink to="/groups" className={({ isActive }) => linkCls(isActive)}><Users className="h-5 w-5" />Groups</NavLink>
        <NavLink to={`/u/${user?.handle}`} className={({ isActive }) => linkCls(isActive)}><User className="h-5 w-5" />My Profile</NavLink>
        <NavLink to="/connections" className={({ isActive }) => linkCls(isActive)}><Users2 className="h-5 w-5" />Connections</NavLink>
        <NavLink to="/settings" className={({ isActive }) => linkCls(isActive)}><Settings className="h-5 w-5" />Settings</NavLink>
        <NavLink to="/reels" className={({ isActive }) => linkCls(isActive)}><Film className="h-5 w-5" />Reels</NavLink>
        {(user?.is_admin || user?.can_moderate) && (
          <NavLink to="/admin" className={({ isActive }) => linkCls(isActive)}><Shield className="h-5 w-5" />Admin</NavLink>
        )}
        <button onClick={() => nav('/?compose=1')} className="mt-3 flex items-center justify-center gap-2 bg-gradient-to-r from-brand to-violet-600 rounded-xl py-3 font-semibold hover:opacity-95">
          <PenSquare className="h-4 w-4" /> New Post
        </button>
        <div className="mt-auto flex items-center gap-3 p-2 rounded-xl hover:bg-white/5">
          <Avatar id={user?.id || ''} name={user?.display_name || ''} url={user?.avatar_url} size={38} />
          <div className="min-w-0 flex-1"><div className="font-medium truncate flex items-center gap-1.5">{user?.display_name}<RoleBadge role={(user as any)?.role} size={14} /><AccountBadge type={(user as any)?.account_type} role={(user as any)?.role} size={13} /></div><div className="text-xs text-slate-500 truncate">#{user?.handle}</div></div>
          <button onClick={logout} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-white/10 text-slate-400"><LogOut className="h-4 w-4" /></button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 border-x border-edge min-h-screen pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />
      </main>

      {/* Trending rail */}
      <aside className="hidden xl:block w-72 shrink-0 p-4">
        <div className="bg-panel border border-edge rounded-2xl p-4 sticky top-4">
          <div className="flex items-center gap-2 font-semibold mb-3"><Sparkles className="h-4 w-4 text-brand" /> Trending tags</div>
          {trending.length === 0 && <p className="text-sm text-slate-500">No trends in the last 24h yet.</p>}
          <div className="space-y-1">
            {trending.map(t => (
              <NavLink key={t.tag} to={`/search?q=${t.tag}`} className="block px-2 py-1.5 rounded-lg hover:bg-white/5">
                <div className="font-medium">#{t.tag}</div>
                <div className="text-xs text-slate-500">{t.count} post{t.count > 1 ? 's' : ''}</div>
              </NavLink>
            ))}
          </div>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-panel border-t border-edge flex items-stretch justify-around pt-2 pb-[calc(env(safe-area-inset-bottom)+0.6rem)]">
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end as any} className={({ isActive }) => `relative flex flex-col items-center gap-1 text-xs ${isActive ? 'text-brand' : 'text-slate-400'}`}>
            <n.icon className="h-5 w-5" />{n.label.split(' ')[0]}
            {n.to === '/messages' && unread > 0 && <span className="absolute -top-1 right-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] grid place-items-center font-bold">{unread > 9 ? '9+' : unread}</span>}
          </NavLink>
        ))}
        <NavLink to={`/u/${user?.handle}`} className={({ isActive }) => `flex flex-col items-center gap-1 text-xs ${isActive ? 'text-brand' : 'text-slate-400'}`}>
          <User className="h-5 w-5" />Me
        </NavLink>
      </nav>

      {/* One-time DOB gate (e.g. Google sign-ups have no DOB yet) */}
      {needsDob && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 backdrop-blur p-4">
          <div className="bg-panel border border-edge rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-bold text-lg">One quick thing</h3>
            <p className="text-sm text-slate-400 mt-1 mb-4">Please confirm your date of birth. This keeps under-18s protected and can't be changed later. You must be 13+.</p>
            <input type="date" value={dob} onChange={e => setDob(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full bg-ink border border-edge rounded-xl px-4 py-3 outline-none focus:border-brand text-slate-200" />
            {dobErr && <p className="text-rose-400 text-sm mt-2">{dobErr}</p>}
            <button onClick={saveDob} disabled={dobBusy || !dob}
              className="mt-4 w-full py-3 rounded-xl bg-gradient-to-r from-brand to-violet-600 font-semibold disabled:opacity-50">
              {dobBusy ? 'Saving…' : 'Continue'}
            </button>
          </div>
        </div>
      )}

      {/* One-time welcome + Comfort-Zone setup for new sign-ups (after DOB is set) */}
      {needsOnboarding && <OnboardingTour user={user} onDone={() => refresh()} />}

      {/* Incoming call ring (app-wide) */}
      {incoming && !activeCall && (
        <IncomingCallScreen call={incoming} onAccept={acceptCall} onDecline={declineCall} />
      )}
      {/* Active call room after accepting an incoming call */}
      {activeCall && (
        <CallModal room={activeCall.room} peer={activeCall.peer} onClose={() => setActiveCall(null)} />
      )}
    </div>
  )
}
