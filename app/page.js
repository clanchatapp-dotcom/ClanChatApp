'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2, LogOut, ShieldCheck, KeyRound } from 'lucide-react'

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001 6.19 5.238 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
  )
}

function Field({ label, ...props }) {
  return (
    <div className="space-y-2">
      {label ? <label className="text-xs uppercase tracking-widest text-neutral-500">{label}</label> : null}
      <input
        {...props}
        className="w-full rounded-2xl bg-neutral-900 border border-neutral-800 px-5 py-4 text-base text-white placeholder:text-neutral-500 outline-none focus:border-neutral-600 transition-colors"
      />
    </div>
  )
}

function LoggedIn({ user, onLogout }) {
  return (
    <div className="w-full max-w-md text-center space-y-6">
      <div className="mx-auto w-16 h-16 rounded-full bg-orange-500/15 flex items-center justify-center">
        <ShieldCheck className="w-8 h-8 text-orange-500" />
      </div>
      <div>
        <h1 className="text-4xl font-bold text-white">You&apos;re in.</h1>
        <p className="mt-2 text-neutral-400">Welcome to the clubhouse, {user.display_name}.</p>
      </div>
      <div className="rounded-2xl bg-neutral-900 border border-neutral-800 p-5 text-left space-y-2">
        <Row k="Display name" v={user.display_name} />
        <Row k="Handle" v={`#${user.handle}`} />
        <Row k="Email" v={user.email} />
        <Row k="Provider" v={user.auth_provider} />
        <Row k="Age" v={`${user.age}${user.is_minor ? ' (minor protections on)' : ''}`} />
      </div>
      <Button onClick={onLogout} variant="ghost" className="text-neutral-400 hover:text-white">
        <LogOut className="w-4 h-4 mr-2" /> Sign out
      </Button>
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-neutral-500">{k}</span>
      <span className="text-white font-medium">{v}</span>
    </div>
  )
}

export default function App() {
  const { user, loading, config, signInWithGoogle, signInWithEmergent, registerWithPassword, signInWithPassword, logout } = useAuth()
  const [mode, setMode] = useState('signin') // Changed default from 'signup' to 'signin'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [dob, setDob] = useState('')
  const [busy, setBusy] = useState(false)
  const [authHint, setAuthHint] = useState(null) // {type:'google'|'password'|'none'}
  const [recoveryToken, setRecoveryToken] = useState(null)
  const [newPassword, setNewPassword] = useState('')

  // Check URL hash for Supabase password recovery access tokens
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const params = new URLSearchParams(window.location.hash.replace('#', '?'))
      const accessToken = params.get('access_token')
      const type = params.get('type')
      if (accessToken && type === 'recovery') {
        setRecoveryToken(accessToken)
        setMode('reset_password')
      }
    }
  }, [])

  const checkAccount = async (value) => {
    const addr = (value ?? email).trim().toLowerCase()
    if (!addr.includes('@')) {
      setAuthHint(null)
      return
    }
    try {
      const r = await fetch('/api/auth/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr }),
      })
      const d = await r.json()
      if (!d.exists) setAuthHint({ type: 'none' })
      else if (d.auth_provider === 'password') setAuthHint({ type: 'password' })
      else setAuthHint({ type: 'google' })
    } catch (e) {
      setAuthHint(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
      </div>
    )
  }

  if (user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <LoggedIn user={user} onLogout={logout} />
      </div>
    )
  }

  const handleGoogle = async () => {
    setBusy(true)
    try {
      signInWithEmergent()
    } catch (e) {
      toast.error(e.message || 'Google sign-in failed')
      setBusy(false)
    }
  }

  const handleResetPassword = async () => {
    if (newPassword.length < 6) return toast.error('Password must be at least 6 characters')
    setBusy(true)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${recoveryToken}`
        },
        body: JSON.stringify({ password: newPassword })
      })
      if (!res.ok) throw new Error('Failed to update password')
      toast.success('Password updated successfully! Please log in.')
      setMode('signin')
      setRecoveryToken(null)
      window.location.hash = ''
    } catch (e) {
      toast.error(e.message || 'Password update failed')
    } finally {
      setBusy(false)
    }
  }

  const handleContinue = async () => {
    if (mode === 'reset_password') return handleResetPassword()
    if (!email.includes('@')) return toast.error('Enter a valid email')
    
    if (mode === 'signup') {
      if (password.length < 6) return toast.error('Password must be at least 6 characters')
      if (!dob) return toast.error('Please enter your date of birth')
      registerWithPassword({ email, password, dob })
      return
    }

    // Sign in mode
    setBusy(true)
    try {
      await signInWithPassword({ email, password })
    } catch (e) {
      if (e?.data?.error === 'oauth_account') {
        setAuthHint({ type: 'google' })
      } else {
        toast.error(e.message || 'Sign in failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex justify-center px-6 py-10">
      <div className="w-full max-w-md">
        {!config.configured && (
          <div className="mb-6 rounded-2xl bg-neutral-900 border border-neutral-800 px-4 py-3 text-sm text-neutral-400 flex items-start gap-2">
            <span className="mt-0.5 text-orange-500">&#9432;</span>
            <span>Dev mode: Google is simulated (no Supabase keys set). The full 2-page flow still works end to end.</span>
          </div>
        )}

        <h1 className="text-5xl font-bold leading-tight">
          {mode === 'reset_password' ? 'Set New Password' : mode === 'signup' ? 'Join the clubhouse' : 'Welcome back'}
        </h1>
        <p className="mt-3 text-lg text-neutral-500">
          {mode === 'reset_password' ? 'Enter your new account password below.' : 'Privacy by design. Zero algorithm.'}
        </p>

        {mode !== 'reset_password' && (
          <>
            <button
              onClick={handleGoogle}
              disabled={busy}
              className="mt-8 w-full rounded-full bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 transition-colors py-4 flex items-center justify-center gap-3 text-lg font-medium disabled:opacity-60"
            >
              <GoogleIcon />
              {mode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}
            </button>

            <div className="my-7 flex items-center gap-4">
              <div className="h-px flex-1 bg-neutral-800" />
              <span className="text-xs uppercase tracking-widest text-neutral-600">or</span>
              <div className="h-px flex-1 bg-neutral-800" />
            </div>
          </>
        )}

        <div className="space-y-4">
          {mode === 'reset_password' ? (
            <Field
              type="password"
              placeholder="New Password (min 6)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          ) : (
            <>
              <Field
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setAuthHint(null) }}
                onBlur={(e) => checkAccount(e.target.value)}
              />
              <Field type="password" placeholder="Password (min 6)" value={password} onChange={(e) => setPassword(e.target.value)} />
              {mode === 'signup' && (
                <div className="pt-2">
                  <label className="text-xs uppercase tracking-widest text-neutral-500">Date of birth</label>
                  <input
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="mt-2 w-full rounded-2xl bg-neutral-900 border border-neutral-800 px-5 py-4 text-base text-white outline-none focus:border-neutral-600 [color-scheme:dark]"
                  />
                  <p className="mt-3 text-sm text-neutral-500">
                    Self-declared. Minor protection rules apply for under-18 accounts.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {authHint?.type === 'google' && (
          <div className="mt-5 rounded-2xl border border-orange-500/40 bg-orange-500/10 p-4">
            <p className="text-sm text-orange-200">
              This account uses <span className="font-semibold">Google sign-in</span> — it has no password.
            </p>
            <button
              onClick={handleGoogle}
              disabled={busy}
              className="mt-3 w-full rounded-full bg-white text-black hover:bg-neutral-200 transition-colors py-3 flex items-center justify-center gap-2 font-semibold disabled:opacity-60"
            >
              <GoogleIcon /> Continue with Google
            </button>
          </div>
        )}

        {authHint?.type === 'none' && mode === 'signin' && (
          <p className="mt-4 text-sm text-neutral-500">
            No account found for this email.{' '}
            <button onClick={() => setMode('signup')} className="text-orange-500 font-semibold hover:underline">
              Create one
            </button>
          </p>
        )}

        {authHint?.type === 'password' && mode === 'signup' && (
          <p className="mt-4 text-sm text-neutral-500">
            You already have an account with this email.{' '}
            <button onClick={() => setMode('signin')} className="text-orange-500 font-semibold hover:underline">
              Sign in instead
            </button>
          </p>
        )}

        <button
          onClick={handleContinue}
          disabled={busy}
          className="mt-7 w-full rounded-full bg-orange-500 hover:bg-orange-600 transition-colors py-4 text-lg font-bold text-black disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="w-5 h-5 animate-spin" />}
          {mode === 'reset_password' ? 'Save New Password' : mode === 'signup' ? 'Continue' : 'Sign in'}
        </button>

        {mode === 'signin' && !authHint && (
          <button
            onClick={() => checkAccount(email)}
            className="mt-4 w-full text-center text-sm text-neutral-500 hover:text-neutral-300"
          >
            Wrong sign-in method?
          </button>
        )}

        {mode !== 'reset_password' && (
          <p className="mt-8 text-center text-neutral-500">
            {mode === 'signup' ? 'Already in? ' : 'New here? '}
            <button
              onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setAuthHint(null) }}
              className="text-orange-500 font-semibold hover:underline"
            >
              {mode === 'signup' ? 'Sign in' : 'Sign up'}
            </button>
          </p>
        )}
      </div>
    </div>
  )
}

