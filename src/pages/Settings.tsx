import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings as SettingsIcon, ShieldCheck, MessageCircle, LogOut, Trash2, Loader2, Check, User as UserIcon, AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Avatar } from '../lib/ui'

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? 'bg-brand' : 'bg-white/15'} ${disabled ? 'opacity-50' : ''}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function Settings() {
  const { user, logout, refresh } = useAuth()
  const nav = useNavigate()
  const [p, setP] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [savedName, setSavedName] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    try { const me = await api.me(); setP(me); setName(me.display_name || '') } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const setPref = async (key: string, value: any) => {
    setP((prev: any) => ({ ...prev, [key]: value }))
    setSaving(key)
    try { await api.updateProfile({ [key]: value }); await refresh() } catch {}
    setSaving(null)
  }

  const saveName = async () => {
    const v = name.trim()
    if (!v || v === p?.display_name) return
    setSaving('display_name')
    try { await api.updateProfile({ display_name: v }); await refresh(); setSavedName(true); setTimeout(() => setSavedName(false), 1500) } catch {}
    setSaving(null)
  }

  const doDelete = async () => {
    setDeleting(true)
    try { await api.deleteAccount() } catch {}
    await logout()
    nav('/', { replace: true })
  }

  if (loading) return <div className="h-full grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>

  return (
    <div className="max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/70 backdrop-blur border-b border-edge px-4 py-3 flex items-center gap-2">
        <SettingsIcon className="h-5 w-5 text-brand" />
        <h1 className="text-lg font-extrabold">Settings</h1>
      </div>

      <div className="p-4 space-y-6">
        {/* Account identity */}
        <section className="bg-panel border border-edge rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <Avatar id={p?.id || ''} name={p?.display_name || ''} url={p?.avatar_url} size={52} />
            <div className="min-w-0">
              <div className="font-semibold truncate">{p?.display_name}</div>
              <div className="text-xs text-slate-500 truncate">#{p?.handle}</div>
            </div>
          </div>

          <label className="block text-sm text-slate-400 mb-1.5">Display name</label>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={40}
              className="flex-1 bg-black/40 border border-edge rounded-xl px-3 py-2.5 outline-none focus:border-brand/60"
              placeholder="Your name"
            />
            <button
              onClick={saveName}
              disabled={saving === 'display_name' || !name.trim() || name.trim() === p?.display_name}
              className="px-4 rounded-xl bg-brand font-medium disabled:opacity-40 flex items-center gap-1.5"
            >
              {saving === 'display_name' ? <Loader2 className="h-4 w-4 animate-spin" /> : savedName ? <Check className="h-4 w-4" /> : null}
              {savedName ? 'Saved' : 'Save'}
            </button>
          </div>

          <div className="mt-4">
            <label className="block text-sm text-slate-400 mb-1.5">Email</label>
            <div className="flex items-center gap-2 bg-black/40 border border-edge rounded-xl px-3 py-2.5 text-slate-400">
              <UserIcon className="h-4 w-4" />
              <span className="truncate">{p?.email || 'Not set'}</span>
            </div>
          </div>
        </section>

        {/* Preferences */}
        <section className="bg-panel border border-edge rounded-2xl p-5 space-y-1">
          <h2 className="font-semibold mb-2 text-slate-300">Privacy preferences</h2>

          <div className="flex items-center gap-3 py-3 border-b border-edge/60">
            <ShieldCheck className="h-5 w-5 text-brand shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Approve new followers</div>
              <div className="text-xs text-slate-500">Manually approve who can follow you instead of open follows.</div>
            </div>
            {saving === 'follow_mode' && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            <Toggle on={p?.follow_mode === 'approval'} onChange={v => setPref('follow_mode', v ? 'approval' : 'open')} />
          </div>

          <div className="flex items-center gap-3 py-3">
            <MessageCircle className="h-5 w-5 text-brand shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Let followers message you</div>
              <div className="text-xs text-slate-500">Inner Circle can always DM. This also opens DMs to your followers.</div>
            </div>
            {saving === 'dm_open' && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            <Toggle on={!!p?.dm_open} onChange={v => setPref('dm_open', v)} />
          </div>
        </section>

        {/* Account actions */}
        <section className="bg-panel border border-edge rounded-2xl p-5 space-y-3">
          <h2 className="font-semibold text-slate-300">Account</h2>
          <button onClick={logout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-edge hover:bg-white/5 transition">
            <LogOut className="h-5 w-5 text-slate-400" />
            <span className="font-medium">Sign out</span>
          </button>
          <button onClick={() => setConfirmDelete(true)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition">
            <Trash2 className="h-5 w-5" />
            <span className="font-medium">Delete account</span>
          </button>
        </section>

        <p className="text-center text-xs text-slate-600 pb-4">ClanChat · app.clanchat.mobile</p>
      </div>

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(false)}>
          <div className="bg-panel border border-edge rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-rose-400 mb-2">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="font-bold text-lg">Delete your account?</h3>
            </div>
            <p className="text-sm text-slate-400 mb-4">
              This permanently deletes your profile, posts, follows, Inner Circle, and messages. This <span className="text-slate-200 font-medium">cannot be undone</span>.
            </p>
            <label className="block text-xs text-slate-500 mb-1.5">Type <span className="font-mono text-slate-300">DELETE</span> to confirm</label>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              className="w-full bg-black/40 border border-edge rounded-xl px-3 py-2.5 outline-none focus:border-rose-500/60 mb-4"
              placeholder="DELETE"
            />
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="flex-1 py-2.5 rounded-xl border border-edge hover:bg-white/5">Cancel</button>
              <button
                onClick={doDelete}
                disabled={confirmText !== 'DELETE' || deleting}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 font-medium disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
