import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { MessageCircle, Lock, Users, Sparkles } from 'lucide-react'

export default function Login() {
  const { loginDev, loginGoogle } = useAuth()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const google = async () => {
    setErr(''); setBusy(true)
    try { await loginGoogle() } catch (e: any) { setErr(e.message || 'Google sign-in failed') }
    finally { setBusy(false) }
  }
  const dev = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await loginDev(name || 'Guest') } catch (e: any) { setErr(e.message || 'Failed') }
    finally { setBusy(false) }
  }

  return (
    <div className="min-h-full grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-brand to-violet-600 grid place-items-center shadow-lg shadow-violet-900/40">
            <MessageCircle className="h-6 w-6 text-white" />
          </div>
          <span className="text-2xl font-extrabold tracking-tight">ClanChat</span>
        </div>
        <div className="space-y-6 max-w-md">
          <h1 className="text-5xl font-extrabold leading-tight">
            Your personal <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-violet-400">clubhouse</span>.
          </h1>
          <p className="text-slate-300 text-lg">No algorithm. No ads in your feed. No toxic metrics. Your circle. Your rules. No bullshit.</p>
          <div className="space-y-3 pt-2">
            {[[Users, 'Three tiers: Public, Followers & Inner Circle'], [Lock, 'Tier-gated, encrypted DMs & calls'], [Sparkles, 'Chronological feed — never an algorithm']].map(([Icon, t]: any, i) => (
              <div key={i} className="flex items-center gap-3 text-slate-200">
                <div className="h-9 w-9 rounded-xl bg-white/5 border border-edge grid place-items-center"><Icon className="h-4 w-4 text-brand" /></div>
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="text-slate-500 text-sm">app.clanchat.mobile · web + android</div>
        <div className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute -top-24 -left-16 h-72 w-72 rounded-full bg-brand/20 blur-3xl" />
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-panel/80 backdrop-blur border border-edge rounded-3xl p-8 shadow-2xl shadow-black/50">
          <div className="lg:hidden flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand to-violet-600 grid place-items-center"><MessageCircle className="h-5 w-5 text-white" /></div>
            <span className="text-xl font-extrabold">ClanChat</span>
          </div>
          <h2 className="text-2xl font-bold">Welcome back</h2>
          <p className="text-slate-400 text-sm mt-1 mb-6">Sign in to continue to your clans.</p>

          <button onClick={google} disabled={busy}
            className="w-full flex items-center justify-center gap-3 bg-white text-slate-900 font-semibold rounded-xl py-3 hover:bg-slate-100 transition disabled:opacity-60">
            <svg className="h-5 w-5" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.9 6.1C12.3 13.2 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.1-3.8 6.5-9.4 6.5-16z"/><path fill="#FBBC05" d="M10.4 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.7l-7.1-5.5c-2 1.4-4.6 2.2-8.4 2.2-6.4 0-11.7-3.7-13.6-9.9l-7.9 6.1C6.4 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 my-6 text-slate-500 text-xs">
            <div className="h-px bg-edge flex-1" /> OR <div className="h-px bg-edge flex-1" />
          </div>

          <form onSubmit={dev} className="space-y-3">
            <label className="text-xs text-slate-400">Quick sandbox sign-in (testing)</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your display name"
              className="w-full bg-ink border border-edge rounded-xl px-4 py-3 outline-none focus:border-brand transition" />
            <button disabled={busy}
              className="w-full bg-gradient-to-r from-brand to-violet-600 font-semibold rounded-xl py-3 hover:opacity-95 transition disabled:opacity-60">
              {busy ? 'Please wait…' : 'Enter ClanChat'}
            </button>
          </form>
          {err && <p className="text-rose-400 text-sm mt-4">{err}</p>}
        </div>
      </div>
    </div>
  )
}
