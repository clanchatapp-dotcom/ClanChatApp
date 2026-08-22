// Native (Android/iOS) Google sign-in via @capgo/capacitor-social-login@7.
// These paths only run inside the Capacitor native shell; on web they no-op.
import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

const env = (import.meta as any).env
const WEB_CLIENT_ID = env.REACT_APP_GOOGLE_WEB_CLIENT_ID as string

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
  const res: any = await SocialLogin.login({
    provider: 'google',
    options: { scopes: ['email', 'profile'] },
  })
  const idToken = res?.result?.idToken
  if (!idToken) throw new Error('No idToken from Google')
  return supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })
}
