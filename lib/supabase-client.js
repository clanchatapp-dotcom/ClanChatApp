'use client'

import { createClient } from '@supabase/supabase-js'

let _client = null

export function getSupabase(url, key) {
  if (!url || !key) return null
  if (_client) return _client
  _client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  })
  return _client
}
