import { createClient } from '@supabase/supabase-js'

const env = (import.meta as any).env
// Public config — safe to ship in the client bundle (anon/publishable key & OAuth
// client id are designed for public exposure). Falling back to baked defaults means
// a missing CI secret can NEVER crash the app into a black screen again.
const PUBLIC_SUPABASE_URL = 'https://fkhsijjwkrwbwjjaapbb.supabase.co'
const PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZraHNpamp3a3J3YndqamFhcGJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MzU3MjMsImV4cCI6MjEwMDQxMTcyM30.0_lwIDS9X1vhrVHPFOMYrn2PwKbzYj43vntx3Fe6k4c'

const url = (env.REACT_APP_SUPABASE_URL as string) || PUBLIC_SUPABASE_URL
const anonKey = (env.REACT_APP_SUPABASE_ANON_KEY as string) || PUBLIC_SUPABASE_ANON_KEY

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
