'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Loader2 } from 'lucide-react'

export default function EmergentCallback() {
  const { handleEmergentSession } = useAuth()
  const router = useRouter()
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const sessionId = fragment.get('session_id')
        // Strip the one-time credential from history immediately.
        window.history.replaceState({}, document.title, window.location.pathname)

        if (!sessionId) {
          setError('No session was returned from Google. Please try again.')
          return
        }

        const data = await handleEmergentSession(sessionId)
        if (cancelled) return
        // New user -> router guard sends to /complete-profile; existing -> app.
        if (!data?.needs_profile) router.replace('/')
      } catch (e) {
        if (!cancelled) setError(e.message || 'Sign-in failed.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [handleEmergentSession, router])

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4 px-6">
      {error ? (
        <>
          <p className="text-red-400 text-center max-w-sm">{error}</p>
          <button
            onClick={() => router.replace('/')}
            className="rounded-full bg-orange-500 hover:bg-orange-600 text-black font-bold px-6 py-3"
          >
            Back to sign up
          </button>
        </>
      ) : (
        <>
          <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
          <p className="text-neutral-400">Signing you in…</p>
        </>
      )}
    </div>
  )
}
