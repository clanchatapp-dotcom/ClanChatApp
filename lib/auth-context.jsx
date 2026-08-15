'use client'

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { getSupabase } from '@/lib/supabase-client'

const TOKEN_KEY = 'clanchat_token'
const AuthContext = createContext(null)

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
      await supabaseRef.current.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      return { redirecting: true }
    }
    // MOCKED dev path (no Supabase keys yet)
    const r = await fetch('/api/auth/dev-google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const g = await r.json()
    return exchangeSupabaseToken({ access_token: g.access_token, provider: 'google' })
  }, [config.configured, exchangeSupabaseToken])

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
      }

      setLoading(false)
    })()
    return () => { try { unsub?.unsubscribe() } catch (e) {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = {
    user,
    pendingProfile,
    config,
    loading,
    signInWithGoogle,
    registerWithPassword,
    signInWithPassword,
    completeProfile,
    abandonProfile,
    logout,
    exchangeSupabaseToken,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
