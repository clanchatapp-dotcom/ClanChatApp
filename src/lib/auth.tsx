import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, signInGoogleWeb } from './supabase'
import { isNative, signInGoogleNative } from './nativeGoogle'
import { api, getToken, setToken } from './api'

type User = { id: string; name: string; email?: string; avatar_url?: string | null }

type AuthCtx = {
  user: User | null
  loading: boolean
  loginDev: (name: string) => Promise<void>
  loginGoogle: () => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null as any)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    // Always sync to the freshest Supabase token first (auto-refreshes an
    // expired Supabase session), then fall back to the stored token (dev login).
    try {
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) setToken(data.session.access_token)
    } catch { /* ignore — dev-login users have no Supabase session */ }

    if (!getToken()) { setUser(null); return }

    try {
      setUser(await api.me())
    } catch (e: any) {
      if (e?.status === 401) {
        // Token rejected. Try one Supabase refresh before giving up so that
        // returning to the app after the access token expired does NOT log you out.
        try {
          const { data } = await supabase.auth.refreshSession()
          if (data.session?.access_token) {
            setToken(data.session.access_token)
            setUser(await api.me())
            return
          }
        } catch { /* no refreshable Supabase session */ }
        // Genuine auth failure (e.g. dev JWT truly expired) -> sign out.
        setToken(null)
        setUser(null)
      }
      // Any non-401 (network blip, 5xx, offline) -> keep the current session.
    }
  }, [])

  useEffect(() => {
    (async () => {
      await refresh()
      setLoading(false)
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setToken(null)
        setUser(null)
        return
      }
      if (session?.access_token) {
        setToken(session.access_token)
        refresh()
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [refresh])

  const loginDev = async (name: string) => {
    const { access_token, user } = await api.devLogin(name)
    setToken(access_token)
    setUser(user)
  }

  const loginGoogle = async () => {
    if (isNative()) {
      const { data } = await signInGoogleNative()
      if (data.session?.access_token) {
        setToken(data.session.access_token)
        await refresh()
      }
    } else {
      await signInGoogleWeb() // full-page redirect to Google
    }
  }

  const logout = async () => {
    await supabase.auth.signOut().catch(() => {})
    setToken(null)
    setUser(null)
  }

  return (
    <Ctx.Provider value={{ user, loading, loginDev, loginGoogle, logout, refresh }}>
      {children}
    </Ctx.Provider>
  )
}
