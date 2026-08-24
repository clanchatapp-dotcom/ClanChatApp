// Native (Android/iOS) Google sign-in via @capgo/capacitor-social-login@7.
// These paths only run inside the Capacitor native shell; on web they no-op.
import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

const env = (import.meta as any).env
// Public OAuth web client id — safe to ship; fall back to the baked default so a
// missing CI secret doesn't break native Google sign-in.
const PUBLIC_GOOGLE_WEB_CLIENT_ID = '24500940599-ps9kauvvquoh2ldh2iacsb04piui40cs.apps.googleusercontent.com'
const WEB_CLIENT_ID = (env.REACT_APP_GOOGLE_WEB_CLIENT_ID as string) || PUBLIC_GOOGLE_WEB_CLIENT_ID

export function isNative(): boolean {
  try { return Capacitor.isNativePlatform() } catch { return false }
}

let initialized = false

export async function initGoogle(): Promise<void> {
  if (initialized || !isNative()) return
  const { SocialLogin } = await import('@capgo/capacitor-social-login')
  await SocialLogin.initialize({
    google: { webClientId: WEB_CLIENT_ID, mode: 'online' },
  })
  initialized = true
}

export async function signInGoogleNative() {
  await initGoogle()
  const { SocialLogin } = await import('@capgo/capacitor-social-login')
  // NOTE: do NOT pass `scopes` here — the capgo v7 plugin rejects custom scopes
  // ("You CANNOT use scopes without modifying the main activity") for the basic
  // online flow. Omitting them uses Google's default email/profile scopes, which
  // is exactly what we need for Supabase signInWithIdToken.
  const res: any = await SocialLogin.login({
    provider: 'google',
    options: {},
  })
  const idToken = res?.result?.idToken
  if (!idToken) throw new Error('No idToken from Google')
  return supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })
}
