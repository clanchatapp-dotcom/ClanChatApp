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
    if (!getToken()) { setUser(null); return }
    try {
      const me = await api.me()
      setUser(me)
    } catch {
      setToken(null)
      setUser(null)
    }
  }, [])

  useEffect(() => {
    (async () => {
      // Prefer a live Supabase session (Google web/native) if present.
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) setToken(data.session.access_token)
      await refresh()
      setLoading(false)
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
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
