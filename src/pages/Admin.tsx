import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { timeAgo } from '../lib/ui'
import { Shield, Flag, AlertTriangle, Users, ScrollText, Ban, Loader2, Check, Trash2 } from 'lucide-react'

const TABS = [
  { key: 'reports', label: 'Reports', icon: Flag },
  { key: 'csam', label: 'CSAM', icon: AlertTriangle },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'audit', label: 'Audit log', icon: ScrollText },
]

function Stat({ label, value, danger }: { label: string; value: any; danger?: boolean }) {
  return (
    <div className="bg-panel border border-edge rounded-2xl p-4">
      <div className={`text-2xl font-extrabold ${danger && value > 0 ? 'text-rose-400' : ''}`}>{value ?? '—'}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  )
}

export default function Admin() {
  const { user } = useAuth()
  const [tab, setTab] = useState('reports')
  const [stats, setStats] = useState<any>({})
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  const loadStats = () => api.adminStats().then(setStats).catch(() => {})
  const load = async () => {
    setLoading(true)
    try {
      if (tab === 'reports') setData(await api.adminReports('open'))
      else if (tab === 'csam') setData(await api.adminCsam())
      else if (tab === 'users') setData(await api.adminUsers(q))
      else if (tab === 'audit') setData(await api.adminAudit())
    } catch { setData([]) } finally { setLoading(false) }
  }
  useEffect(() => { loadStats() }, [])
  useEffect(() => { load() }, [tab])

  if (user && !user.is_admin) return <Navigate to="/" replace />

  const act = async (id: string, action: string) => {
    let reason = ''
    if (action !== 'dismiss') reason = window.prompt(`Reason for "${action.replace('_', ' ')}"?`, '') || ''
    await api.adminAction(id, action, reason); await load(); await loadStats()
  }
  const strike = async (handle: string, soft: boolean) => {
    const reason = window.prompt(soft ? 'Soft warning message:' : 'Strike reason:', '') || ''
    if (!reason) return
    await api.adminStrike(handle, reason, soft ? 'soft' : undefined); await load(); await loadStats()
  }
  const unsuspend = async (handle: string) => { await api.adminUnsuspend(handle); await load(); await loadStats() }

  return (
    <div>
      <div className="sticky top-0 z-30 bg-ink/80 backdrop-blur border-b border-edge px-4 py-3 flex items-center gap-2">
        <Shield className="h-5 w-5 text-brand" /><h1 className="text-xl font-extrabold">Admin</h1>
        <span className="text-xs text-slate-500 ml-2">Reports · CSAM · Trust &amp; Safety</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
          <Stat label="Users" value={stats.users} />
          <Stat label="Posts" value={stats.posts} />
          <Stat label="Open reports" value={stats.open_reports} danger />
          <Stat label="CSAM queue" value={stats.csam_reports} danger />
          <Stat label="Suspended" value={stats.suspended} />
          <Stat label="Banned" value={stats.banned} />
        </div>

        <div className="flex gap-1 bg-panel border border-edge rounded-xl p-1 w-fit">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg ${tab === t.key ? 'bg-brand text-white' : 'text-slate-400 hover:text-white'}`}>
              <t.icon className="h-4 w-4" />{t.label}
            </button>
          ))}
        </div>

        {tab === 'users' && (
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="Search users, press Enter…" className="w-full bg-ink border border-edge rounded-xl px-4 py-2.5 outline-none focus:border-brand" />
        )}

        {loading ? <div className="py-16 grid place-items-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
          <div className="space-y-2">
            {data.length === 0 && <p className="text-center text-slate-500 py-10">Nothing here.</p>}

            {tab === 'reports' && data.map(r => (
              <div key={r.id} className="bg-panel border border-edge rounded-2xl p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${['csam', 'underage'].includes(r.category) ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>{r.category}</span>
                  <span className="text-sm text-slate-400">{r.target_type}</span>
                  {r.target_user && <span className="text-sm">→ #{r.target_user.handle}</span>}
                  <span className="text-xs text-slate-600 ml-auto">reported by #{r.reporter_handle} · {timeAgo(r.created_at)}</span>
                </div>
                {r.preview && <div className="mt-2 text-sm text-slate-300 bg-ink border border-edge rounded-lg p-2">
                  {r.preview.text || '(no text)'} {r.preview.quarantined && <span className="text-rose-400 text-xs">· quarantined</span>}
                </div>}
                {r.note && <p className="mt-1 text-xs text-slate-500">Note: {r.note}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => act(r.id, 'dismiss')} className="px-3 py-1.5 rounded-lg border border-edge text-sm">Dismiss</button>
                  <button onClick={() => act(r.id, 'remove_content')} className="px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 text-sm flex items-center gap-1"><Trash2 className="h-3.5 w-3.5" />Remove content</button>
                  <button onClick={() => act(r.id, 'warn_user')} className="px-3 py-1.5 rounded-lg bg-white/5 text-sm">Soft warn</button>
                  <button onClick={() => act(r.id, 'strike_user')} className="px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 text-sm flex items-center gap-1"><Ban className="h-3.5 w-3.5" />Strike</button>
                </div>
              </div>
            ))}

            {tab === 'csam' && data.map(r => (
              <div key={r.id} className="bg-rose-500/5 border border-rose-500/30 rounded-2xl p-4">
                <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-rose-400" />
                  <span className="font-semibold text-rose-300">{r.category}</span>
                  <span className="text-xs text-slate-500 ml-auto">{timeAgo(r.created_at)}</span></div>
                <div className="text-sm text-slate-400 mt-1">{r.target_type} · {r.target_id} · reporter #{r.reporter_handle}</div>
                <div className="text-xs text-rose-400/80 mt-1">Auto-quarantined. Escalate to CEOP/NCMEC (pipeline scaffolded).</div>
              </div>
            ))}

            {tab === 'users' && data.map(u => (
              <div key={u.id} className="bg-panel border border-edge rounded-2xl p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate flex items-center gap-2">{u.display_name}
                    {u.is_admin && <Shield className="h-3.5 w-3.5 text-brand" />}
                    {u.banned && <span className="text-xs bg-rose-500/20 text-rose-300 px-1.5 rounded">banned</span>}
                    {u.suspended_until && !u.banned && <span className="text-xs bg-amber-500/20 text-amber-300 px-1.5 rounded">suspended</span>}
                  </div>
                  <div className="text-xs text-slate-500">#{u.handle} · {u.account_type} · strikes: {u.strikes}</div>
                </div>
                <button onClick={() => strike(u.handle, true)} className="px-2.5 py-1.5 rounded-lg bg-white/5 text-xs">Warn</button>
                <button onClick={() => strike(u.handle, false)} className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 text-xs">Strike</button>
                {(u.suspended_until || u.banned) && <button onClick={() => unsuspend(u.handle)} className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs flex items-center gap-1"><Check className="h-3 w-3" />Restore</button>}
              </div>
            ))}

            {tab === 'audit' && data.map(r => (
              <div key={r.id} className="bg-panel border border-edge rounded-2xl p-3 text-sm flex items-center gap-3">
                <ScrollText className="h-4 w-4 text-slate-500" />
                <div className="flex-1"><span className="font-medium">#{r.admin_handle}</span> <span className="text-brand">{r.action}</span> <span className="text-slate-400">{r.target}</span>
                  {r.detail && <span className="text-slate-500"> — {r.detail}</span>}</div>
                <span className="text-xs text-slate-600">{timeAgo(r.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
