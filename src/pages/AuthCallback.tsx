import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { setToken } from '../lib/api'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [msg, setMsg] = useState('Completing sign-in…')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const params = new URLSearchParams(window.location.search)
      const oauthErr = params.get('error_description')
      const code = params.get('code')
      if (oauthErr) { setFailed(true); setMsg(oauthErr); return }
      if (!code) { setFailed(true); setMsg('Missing authorization code'); return }
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      if (cancelled) return
      if (error) { setFailed(true); setMsg('Could not complete sign-in'); return }
      if (data.session?.access_token) setToken(data.session.access_token)
      navigate('/', { replace: true })
    })()
    return () => { cancelled = true }
  }, [navigate])

  return (
    <div className="h-full grid place-items-center p-6">
      <div className="bg-panel border border-edge rounded-2xl p-8 text-center max-w-sm">
        <p className={failed ? 'text-rose-400' : 'text-slate-200'}>{msg}</p>
        {failed && (
          <button onClick={() => navigate('/', { replace: true })}
            className="mt-5 bg-indigo-500 rounded-xl px-5 py-2.5 font-semibold hover:bg-indigo-400 transition">
            Back to sign-in
          </button>
        )}
      </div>
    </div>
  )
}
