import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { formatApiError } from "../lib/api";
import { toast } from "sonner";
import { GoogleButton } from "./Login";

export default function Register() {
  const { register, registerWithSupabaseEmail } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({
    email: "", password: "", handle: "", display_name: "", dob: ""
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Supabase-first signup. Falls back to legacy /auth/register if Supabase
  // is temporarily unavailable so signups aren't hard-blocked while
  // providers are being configured.
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await registerWithSupabaseEmail(form.email, form.password, form.dob, form.handle);
      toast.success("Account created");
      nav("/feed", { replace: true });
      return;
    } catch (sbErr) {
      const msg = (sbErr?.message || "").toLowerCase();
      const status = sbErr?.response?.status;
      if (msg.includes("user already registered") || msg.includes("already been registered")) {
        setErr("That email already has an account. Try signing in instead.");
        setBusy(false);
        return;
      }
      // Fall through to legacy register when Supabase is unavailable
      // (production not yet redeployed → 404 on /api/auth/supabase-login
      // or /api/supabase/config), when config is missing, or when
      // provider isn't enabled yet.
      //
      // ALSO fall through when Supabase itself succeeded but returned
      // no session (email-confirmation is enabled on the project — the
      // Supabase user exists but they can't log in until they click a
      // link in their email). Rather than blocking the user, we create
      // the ClanChat account directly via the legacy endpoint so they
      // can start using the app immediately. This was the "no-one can
      // sign up" incident on production.
      const shouldFallback =
        status === 404 || status === 502 || status === 503 ||
        msg.includes("supabase config unavailable") ||
        msg.includes("network error") ||
        msg.includes("failed to fetch") ||
        msg.includes("provider is not enabled") ||
        msg.includes("no supabase session") ||
        msg.includes("email not confirmed") ||
        msg.includes("email link is invalid") ||
        msg === "";
      if (!shouldFallback) {
        setErr(sbErr.message || String(sbErr));
        setBusy(false);
        return;
      }
    }
    try {
      await register(form);
      toast.success("Account created");
      nav("/feed", { replace: true });
    } catch (legacyErr) {
      setErr(formatApiError(legacyErr.response?.data?.detail) || legacyErr.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="px-6 pt-12 pb-24 min-h-screen">
      <Link to="/" className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">ClanChat</Link>
      <h1 className="font-heading text-4xl mt-3">Join the clubhouse</h1>
      <p className="text-zinc-500 mt-2 text-sm">Privacy by design. # handles, three tiers, zero algorithm.</p>

      <form onSubmit={submit} className="flex flex-col gap-3 mt-8">
        <input data-testid="reg-email" className="cc-input" type="email" placeholder="Email"
          value={form.email} onChange={e => set("email", e.target.value)} required />
        <input data-testid="reg-password" className="cc-input" type="password" placeholder="Password (min 6)"
          value={form.password} onChange={e => set("password", e.target.value)} required />
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">#</span>
          <input data-testid="reg-handle" className="cc-input pl-7" placeholder="handle"
            value={form.handle} onChange={e => set("handle", e.target.value.toLowerCase())} required />
        </div>
        <input data-testid="reg-display" className="cc-input" placeholder="Display name"
          value={form.display_name} onChange={e => set("display_name", e.target.value)} required />
        <label className="text-xs uppercase tracking-[0.2em] text-zinc-500 mt-2">Date of birth</label>
        <input data-testid="reg-dob" className="cc-input" type="date" value={form.dob}
          onChange={e => set("dob", e.target.value)} required />
        <p className="text-xs text-zinc-500">Self-declared. Minor protection rules apply for under-18 accounts.</p>
        {err && <div className="text-sm text-red-400" data-testid="reg-error">{err}</div>}
        <button data-testid="reg-submit" className="cc-btn-primary mt-3" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>

      <div className="flex items-center gap-3 my-6 text-zinc-600 text-xs uppercase tracking-[0.2em]">
        <div className="flex-1 h-px bg-zinc-900" /> or <div className="flex-1 h-px bg-zinc-900" />
      </div>
      <GoogleButton extra="Sign up with Google" />
      <p className="text-center text-sm text-zinc-500 mt-8">
        Already in? <Link to="/login" className="text-[#FF5A00] hover:underline" data-testid="login-link">Sign in</Link>
      </p>
    </div>
  );
}
