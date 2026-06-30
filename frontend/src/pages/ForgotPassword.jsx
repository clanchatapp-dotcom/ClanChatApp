import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { KeyRound, ArrowLeft } from "lucide-react";
import api, { formatApiError } from "../lib/api";

/**
 * /forgot-password — public, no auth required.
 *
 * The user can't log in (forgotten password) so we cannot verify identity
 * with a current password. We also haven't wired email yet, so a reset
 * *link* is not possible. Pattern shipped here:
 *
 *   1. User submits handle + email + (optional) reason.
 *   2. We file a "password_reset_request" record visible to admins only.
 *   3. Admin reviews the request, contacts the user out-of-band (DM/email/
 *      phone) to verify it's really them, then uses the existing
 *      /admin/users/{id}/reset-password tool to issue a temporary password.
 *   4. Admin closes the ticket.
 *
 * Critically: we ALWAYS return the same success message regardless of
 * whether the email/handle matches an actual account. This stops attackers
 * using this endpoint to enumerate which emails belong to ClanChat users.
 */
export default function ForgotPassword() {
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
    try {
      await api.post("/auth/request-reset", {
        email: email.trim(),
        handle: handle.trim().replace(/^#/, ""),
        reason: reason.trim(),
      });
      setSubmitted(true);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
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
        <h1 className="font-heading text-3xl mb-3">Request received</h1>
        <p className="text-sm text-zinc-400 leading-relaxed mb-2">
          If an account with these details exists, an admin will review your request and reach out to you to verify it&apos;s really you.
        </p>
        <p className="text-xs text-zinc-600 leading-relaxed mt-4">
          We don&apos;t confirm whether an email is on file — that&apos;s a privacy protection so attackers can&apos;t use this form to fish for who&apos;s on ClanChat. Either way, if it&apos;s you, you&apos;ll hear back.
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
