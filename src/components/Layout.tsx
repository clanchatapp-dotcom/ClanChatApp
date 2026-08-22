import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Home, Search, MessageCircle, Bell, User, LogOut, Sparkles, PenSquare, Shield } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { Avatar } from '../lib/ui'

const NAV = [
  { to: '/', icon: Home, label: 'My Feed', end: true },
  { to: '/search', icon: Search, label: 'Discover' },
  { to: '/messages', icon: MessageCircle, label: 'Messages' },
  { to: '/activity', icon: Bell, label: 'Activity' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [trending, setTrending] = useState<any[]>([])
  useEffect(() => { api.trending().then(setTrending).catch(() => {}) }, [])

  const linkCls = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition ${active ? 'bg-brand/15 text-white border border-brand/30' : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'}`

  return (
    <div className="min-h-full max-w-7xl mx-auto flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 h-screen sticky top-0 p-4 gap-1">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand to-violet-600 grid place-items-center"><MessageCircle className="h-5 w-5 text-white" /></div>
          <span className="font-extrabold text-lg">ClanChat</span>
        </div>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end as any} className={({ isActive }) => linkCls(isActive)}>
            <n.icon className="h-5 w-5" />{n.label}
          </NavLink>
        ))}
        <NavLink to={`/u/${user?.handle}`} className={({ isActive }) => linkCls(isActive)}><User className="h-5 w-5" />My Profile</NavLink>
        {user?.is_admin && (
          <NavLink to="/admin" className={({ isActive }) => linkCls(isActive)}><Shield className="h-5 w-5" />Admin</NavLink>
        )}
        <button onClick={() => nav('/?compose=1')} className="mt-3 flex items-center justify-center gap-2 bg-gradient-to-r from-brand to-violet-600 rounded-xl py-3 font-semibold hover:opacity-95">
          <PenSquare className="h-4 w-4" /> New Post
        </button>
        <div className="mt-auto flex items-center gap-3 p-2 rounded-xl hover:bg-white/5">
          <Avatar id={user?.id || ''} name={user?.display_name || ''} url={user?.avatar_url} size={38} />
          <div className="min-w-0 flex-1"><div className="font-medium truncate">{user?.display_name}</div><div className="text-xs text-slate-500 truncate">#{user?.handle}</div></div>
          <button onClick={logout} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-white/10 text-slate-400"><LogOut className="h-4 w-4" /></button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 border-x border-edge min-h-screen pb-20 md:pb-0">
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
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-panel/95 backdrop-blur border-t border-edge flex items-center justify-around h-16">
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end as any} className={({ isActive }) => `flex flex-col items-center gap-1 text-xs ${isActive ? 'text-brand' : 'text-slate-400'}`}>
            <n.icon className="h-5 w-5" />{n.label.split(' ')[0]}
          </NavLink>
        ))}
        <NavLink to={`/u/${user?.handle}`} className={({ isActive }) => `flex flex-col items-center gap-1 text-xs ${isActive ? 'text-brand' : 'text-slate-400'}`}>
          <User className="h-5 w-5" />Me
        </NavLink>
      </nav>
    </div>
  )
}
