import { createClient } from '@supabase/supabase-js'

const env = (import.meta as any).env
const url = env.REACT_APP_SUPABASE_URL as string
const anonKey = env.REACT_APP_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, anonKey, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

// Web Google sign-in -> redirects the browser to Google, returns to /auth/callback
export async function signInGoogleWeb() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
}
