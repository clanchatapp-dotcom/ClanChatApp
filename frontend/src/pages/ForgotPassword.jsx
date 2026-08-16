import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { KeyRound, ArrowLeft } from "lucide-react";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";

/**
 * /forgot-password — public, no auth required.
 *
 * Firebase Auth handles password reset natively — it sends a signed
 * one-time link to the account email that lets the user set a new
 * password without any human review. We ALWAYS return the same success
 * message regardless of whether the email is on file, so attackers
 * can't use this form to enumerate ClanChat accounts.
 *
 * The legacy admin-review request (POST /auth/request-reset) is still
 * fired as a backup — that way accounts that pre-date Firebase migration
 * still get a human touchpoint even if their Firebase reset link expires.
 */
export default function ForgotPassword() {
  const { requestSupabasePasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !handle.trim()) {
      toast.error("Email and handle both required");
      return;
    }
    setBusy(true);
    // Fire the Supabase reset email (primary) and the legacy admin ticket
    // (backup) in parallel. Both are silent-on-nonexistent-account so
    // this doesn't leak whether an email is registered.
    const supabaseSend = requestSupabasePasswordReset(email.trim())
      .catch((err) => {
        console.warn("supabase reset email failed:", err?.message || err);
      });
    const legacySend = api.post("/auth/request-reset", {
      email: email.trim(),
      handle: handle.trim().replace(/^#/, ""),
      reason: reason.trim(),
    }).catch((err) => {
      console.warn("legacy reset ticket failed:", formatApiError(err.response?.data?.detail));
    });
    try {
      await Promise.allSettled([supabaseSend, legacySend]);
      setSubmitted(true);
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <div className="px-6 pt-16 pb-24 min-h-screen flex flex-col" data-testid="forgot-pw-submitted">
        <Link to="/login" className="text-zinc-500 text-xs inline-flex items-center gap-1 mb-10">
          <ArrowLeft size={12} /> Back to sign in
        </Link>
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-6">
          <KeyRound size={22} className="text-emerald-300" />
        </div>
        <h1 className="font-heading text-3xl mb-3">Check your email</h1>
        <p className="text-sm text-zinc-400 leading-relaxed mb-2">
          If an account with that email exists, we&apos;ve sent a password reset link. It expires in 1 hour — check spam if it doesn&apos;t arrive.
        </p>
        <p className="text-xs text-zinc-600 leading-relaxed mt-4">
          We don&apos;t confirm whether an email is on file — that&apos;s a privacy protection so attackers can&apos;t use this form to fish for who&apos;s on ClanChat.
        </p>
        <Link to="/login" className="cc-btn-secondary mt-10 text-center" data-testid="forgot-pw-back-link">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="px-6 pt-16 pb-24 min-h-screen flex flex-col">
      <Link to="/login" className="text-zinc-500 text-xs inline-flex items-center gap-1 mb-10">
        <ArrowLeft size={12} /> Back to sign in
      </Link>
      <div className="mb-8">
        <div className="w-12 h-12 rounded-2xl bg-[#FF5A00]/10 border border-[#FF5A00]/30 flex items-center justify-center mb-4">
          <KeyRound size={20} className="text-[#FF5A00]" />
        </div>
        <h1 className="font-heading text-3xl mt-1">Forgot password?</h1>
        <p className="text-zinc-500 mt-2 text-sm leading-relaxed">
          Fill this in and an admin will get you back in. Used for accounts that signed up with email + password — Google sign-in users should recover via Google directly.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          data-testid="forgot-pw-email"
          autoComplete="email"
          className="cc-input"
          type="email"
          placeholder="Email on the account"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          data-testid="forgot-pw-handle"
          className="cc-input"
          placeholder="# handle (without the #)"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          required
        />
        <textarea
          data-testid="forgot-pw-reason"
          className="cc-input min-h-20"
          placeholder="(Optional) Anything that helps us verify it's you — e.g. when you signed up, what device you used"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
        />
        <button
          data-testid="forgot-pw-submit"
          className="cc-btn-primary mt-2"
          disabled={busy}
        >
          {busy ? "Submitting…" : "Request password reset"}
        </button>
      </form>
      <p className="text-[10px] text-zinc-600 mt-6 text-center leading-relaxed">
        Reviewed by a human admin. Expect a response within 24 hours.
      </p>
    </div>
  );
}
