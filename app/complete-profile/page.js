'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Loader2, ArrowLeft } from 'lucide-react'

function LabeledInput({ label, error, prefix, ...props }) {
  return (
    <div className="space-y-2">
      <label className="text-xs uppercase tracking-widest text-neutral-500">{label}</label>
      <div className={`flex items-center rounded-2xl bg-neutral-900 border px-5 ${error ? 'border-red-500/70' : 'border-neutral-800 focus-within:border-neutral-600'}`}>
        {prefix ? <span className="text-neutral-500 text-lg mr-1">{prefix}</span> : null}
        <input
          {...props}
          className="w-full bg-transparent py-4 text-base text-white placeholder:text-neutral-500 outline-none [color-scheme:dark]"
        />
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  )
}

export default function CompleteProfile() {
  const { pendingProfile, completeProfile, abandonProfile } = useAuth()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [dob, setDob] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState({})

  // Prefill from the pending Google/session profile.
  useEffect(() => {
    if (!pendingProfile) return
    setEmail(pendingProfile.supabase_email || '')
    setDisplayName(pendingProfile.supabase_name || '')
    if (pendingProfile.dob) setDob(pendingProfile.dob)
  }, [pendingProfile])

  // Router guard handles redirect when there is no pending profile.
  if (!pendingProfile) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
      </div>
    )
  }

  const goBack = async () => {
    // Abandon = start from scratch
    await abandonProfile()
    router.replace('/')
  }

  const submit = async () => {
    setErrors({})
    if (!handle || handle.replace(/[^a-z0-9_]/gi, '').length < 3) {
      return setErrors({ handle: 'Pick a handle with at least 3 letters/numbers.' })
    }
    if (!email.includes('@')) return setErrors({ email: 'Enter a valid email.' })
    if (!dob) return setErrors({ dob: 'Enter your date of birth.' })
    setBusy(true)
    try {
      await completeProfile({ email, handle, display_name: displayName, dob })
      // Success -> AuthContext sets user, guard clears; land on the app.
      router.replace('/')
    } catch (e) {
      const code = e?.data?.error
      if (code === 'handle_taken') setErrors({ handle: 'That #handle is already taken.' })
      else if (code === 'email_in_use') setErrors({ email: 'That email is already in use.' })
      else if (code === 'age') setErrors({ dob: 'You must be at least 13 years old to join.' })
      else if (code === 'invalid_dob') setErrors({ dob: 'Enter a valid date of birth.' })
      else if (code === 'invalid_handle') setErrors({ handle: 'Handle must be 3+ characters.' })
      else setErrors({ form: e.message || 'Something went wrong.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <button onClick={goBack} className="mb-6 flex items-center gap-2 text-neutral-500 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <h1 className="text-5xl font-bold leading-tight">Complete your profile</h1>
        <p className="mt-3 text-lg text-neutral-500">One quick step and you&apos;re in.</p>

        <div className="mt-8 space-y-5">
          <LabeledInput
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            placeholder="you@example.com"
          />
          <LabeledInput
            label="Handle"
            prefix="#"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            error={errors.handle}
            placeholder="yourhandle"
            maxLength={20}
          />
          <LabeledInput
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            error={errors.displayName}
            placeholder="Your name"
          />
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-neutral-500">Date of birth</label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className={`w-full rounded-2xl bg-neutral-900 border px-5 py-4 text-base text-white outline-none [color-scheme:dark] ${errors.dob ? 'border-red-500/70' : 'border-neutral-800 focus:border-neutral-600'}`}
            />
            {errors.dob ? <p className="text-sm text-red-400">{errors.dob}</p> : null}
            <p className="text-sm text-neutral-500">Self-declared. Minor protection rules apply for under-18 accounts.</p>
          </div>
        </div>

        {errors.form ? <p className="mt-4 text-sm text-red-400">{errors.form}</p> : null}

        <button
          onClick={submit}
          disabled={busy}
          className="mt-8 w-full rounded-full bg-orange-500 hover:bg-orange-600 transition-colors py-4 text-lg font-bold text-black disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="w-5 h-5 animate-spin" />}
          Create account
        </button>
      </div>
    </div>
  )
}
