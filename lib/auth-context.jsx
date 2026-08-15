'use client'

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { getSupabase } from '@/lib/supabase-client'

const TOKEN_KEY = 'clanchat_token'
const AuthContext = createContext(null)

// Detect Capacitor native runtime (APK/iOS). Safe on web (returns false).
function isNativePlatform() {
  try {
    if (typeof window === 'undefined' || !window.Capacitor) return false
    return window.Capacitor.isNativePlatform
      ? window.Capacitor.isNativePlatform()
      : !!window.Capacitor.isNative
  } catch (e) {
    return false
  }
}

// The custom scheme the APK registers to receive the OAuth return.
const NATIVE_REDIRECT = 'clanchat://auth-callback'

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

function saveToken(t) {
  try { window.localStorage.setItem(TOKEN_KEY, t) } catch (e) {}
}
function readToken() {
  try { return window.localStorage.getItem(TOKEN_KEY) } catch (e) { return null }
}
function clearToken() {
  try { window.localStorage.removeItem(TOKEN_KEY) } catch (e) {}
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [pendingProfile, setPendingProfile] = useState(null)
  const [config, setConfig] = useState({ configured: false, supabase_url: '', supabase_anon_key: '' })
  const [loading, setLoading] = useState(true)
  const supabaseRef = useRef(null)

  // ---- low level helpers --------------------------------------------------
  const forgetToken = useCallback(() => {
    clearToken()
  }, [])

  const supabaseSignOut = useCallback(async () => {
    try { await supabaseRef.current?.auth?.signOut() } catch (e) {}
  }, [])

  // POST /auth/supabase-login. Returns backend data.
  // - needs_profile -> setPendingProfile (keeps access_token/provider for phase 2)
  // - token -> log the user in
  const exchangeSupabaseToken = useCallback(async (payload) => {
    const res = await fetch('/api/auth/supabase-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(data.message || data.error || 'Request failed')
      err.status = res.status
      err.data = data
      throw err
    }
    if (data.needs_profile) {
      // keep the transient auth material so phase 2 can complete
      setPendingProfile({
        ...data,
        access_token: payload.access_token,
        provider: payload.provider,
        password: payload.password,
        dob: payload.dob,
      })
      return data
    }
    if (data.token) {
      saveToken(data.token)
      setUser(data.user)
      setPendingProfile(null)
    }
    return data
  }, [])

  // ---- public actions -----------------------------------------------------
  const signInWithGoogle = useCallback(async () => {
    if (config.configured && supabaseRef.current) {
      const supabase = supabaseRef.current
      const isNative = isNativePlatform()
      // WEB: return to the site origin. NATIVE: return to the deep link so the
      // APK can re-enter itself instead of loading a web URL that 404s.
      const redirectTo = isNative ? NATIVE_REDIRECT : window.location.origin
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: isNative },
      })
      if (error) throw error
      if (isNative && data?.url) {
        // Open Google in a Chrome Custom Tab. Requires @capacitor/browser in the
        // native project; Google blocks OAuth inside a plain WebView.
        const Browser = window.Capacitor?.Plugins?.Browser
        if (Browser?.open) {
          await Browser.open({ url: data.url })
        } else {
          window.open(data.url, '_system')
        }
      }
      return { redirecting: true }
    }
    // MOCKED dev path (no Supabase keys set)
    const r = await fetch('/api/auth/dev-google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const g = await r.json()
    return exchangeSupabaseToken({ access_token: g.access_token, provider: 'google' })
  }, [config.configured, exchangeSupabaseToken])

  // ---- Emergent-managed Google -------------------------------------------
  const signInWithEmergent = useCallback(() => {
    const callback = new URL('/auth/emergent/callback', window.location.origin)
    const authUrl = new URL('https://auth.emergentagent.com/')
    authUrl.searchParams.set('redirect', callback.toString())
    window.location.assign(authUrl.toString())
  }, [])

  // Called by the callback page with the session_id from the URL fragment.
  const handleEmergentSession = useCallback(async (session_id) => {
    const res = await fetch('/api/auth/emergent/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(data.message || data.error || 'Sign-in failed')
      err.status = res.status
      err.data = data
      throw err
    }
    if (data.needs_profile) {
      setPendingProfile({
        ...data,
        provider: 'emergent',
        profile_ticket: data.profile_ticket,
      })
      return data
    }
    if (data.token) {
      saveToken(data.token)
      setUser(data.user)
      setPendingProfile(null)
    }
    return data
  }, [])

  // Page 1 email/password "Continue" -> go to profile step (no account yet)
  const registerWithPassword = useCallback(({ email, password, dob }) => {
    setPendingProfile({
      needs_profile: true,
      provider: 'password',
      supabase_email: email,
      supabase_name: '',
      password,
      dob,
    })
  }, [])

  const signInWithPassword = useCallback(async ({ email, password }) => {
    const res = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(data.message || 'Sign in failed')
      err.status = res.status
      err.data = data
      throw err
    }
    saveToken(data.token)
    setUser(data.user)
    return data
  }, [])

  // Page 2 submit
  const completeProfile = useCallback(async ({ email, handle, display_name, dob }) => {
    const p = pendingProfile || {}
    const data = await exchangeSupabaseToken({
      provider: p.provider || 'google',
      access_token: p.access_token,
      password: p.password,
      profile_ticket: p.profile_ticket,
      email,
      handle,
      display_name,
      dob,
    })
    return data
  }, [pendingProfile, exchangeSupabaseToken])

  // "Start from scratch" reset
  const abandonProfile = useCallback(async () => {
    await supabaseSignOut()
    forgetToken()
    setPendingProfile(null)
    setUser(null)
  }, [supabaseSignOut, forgetToken])

  const logout = useCallback(async () => {
    await supabaseSignOut()
    forgetToken()
    setUser(null)
    setPendingProfile(null)
  }, [supabaseSignOut, forgetToken])

  // ---- boot / hydrate -----------------------------------------------------
  useEffect(() => {
    let unsub = null
    let appUrlUnsub = null
    ;(async () => {
      // 1) load public config
      let cfg = { configured: false, supabase_url: '', supabase_anon_key: '' }
      try {
        const r = await fetch('/api/config')
        cfg = await r.json()
      } catch (e) {}
      setConfig(cfg)

      const supabase = cfg.configured ? getSupabase(cfg.supabase_url, cfg.supabase_anon_key) : null
      supabaseRef.current = supabase

      // 2) hydrate from stored internal token
      const token = readToken()
      if (token) {
        try {
          const r = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
          if (r.ok) {
            const d = await r.json()
            setUser(d.user)
          } else {
            clearToken()
          }
        } catch (e) {}
      }

      // 3) hydrate from supabase session (real OAuth return) -> USE the result
      if (supabase) {
        try {
          const { data } = await supabase.auth.getSession()
          const session = data?.session
          if (session?.access_token && !readToken()) {
            await exchangeSupabaseToken({ access_token: session.access_token, provider: 'google' })
          }
        } catch (e) {}

        // 4) live listener -> USE the result
        const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN' && session?.access_token && !readToken()) {
            try {
              await exchangeSupabaseToken({ access_token: session.access_token, provider: 'google' })
            } catch (e) {}
          }
        })
        unsub = sub?.subscription

        // 5) NATIVE: handle the deep-link return clanchat://auth-callback?code=...
        // On native, detectSessionInUrl can't process a custom scheme, so we
        // exchange the code manually; the SIGNED_IN listener above then runs.
        if (isNativePlatform() && window.Capacitor?.Plugins?.App?.addListener) {
          try {
            const appListener = await window.Capacitor.Plugins.App.addListener('appUrlOpen', async ({ url }) => {
              try {
                if (!url || url.indexOf(NATIVE_REDIRECT) !== 0) return
                try { await window.Capacitor?.Plugins?.Browser?.close?.() } catch (e) {}
                const params = new URLSearchParams((url.split('?')[1] || ''))
                const code = params.get('code')
                if (code && !readToken()) {
                  await supabase.auth.exchangeCodeForSession(code)
                }
              } catch (e) {}
            })
            appUrlUnsub = appListener
          } catch (e) {}
        }
      }

      setLoading(false)
    })()
    return () => {
      try { unsub?.unsubscribe() } catch (e) {}
      try { appUrlUnsub?.remove?.() } catch (e) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = {
    user,
    pendingProfile,
    config,
    loading,
    signInWithGoogle,
    signInWithEmergent,
    handleEmergentSession,
    registerWithPassword,
    signInWithPassword,
    completeProfile,
    abandonProfile,
    logout,
    exchangeSupabaseToken,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
