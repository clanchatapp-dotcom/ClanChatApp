import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getSupabase } from "../lib/supabase";
import { formatApiError } from "../lib/api";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react"; // Or use emoji ("👁️"/"🙈") if you prefer no icon imports

/**
 * Firebase-powered Google button — replaces the old Emergent OAuth flow.
 *
 * On desktop this opens a popup; on mobile / Capacitor it runs a redirect
 * flow whose result is picked up by AuthContext on the next load via
 * getRedirectResult.
 */
function GoogleButton({ extra }) {
  const { loginWithSupabaseGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      // Supabase OAuth kicks a redirect; on return, AuthContext's onMount
      // effect exchanges the session for a ClanChat JWT automatically.
      await loginWithSupabaseGoogle();
    } catch (e) {
      const msg = e?.message || "Google sign-in failed";
      if (msg.toLowerCase().includes("provider is not enabled")) {
        toast.error("Google sign-in is not enabled in the Supabase dashboard yet");
      } else {
        toast.error(msg);
      }
    } finally {
      // On native, loginWithSupabaseGoogle() only kicks off the Chrome
      // Custom Tab redirect and returns immediately — the real result
      // lands later via the appUrlOpen deep-link handler in AuthContext.
      // Resetting busy here (not just on error) is what unsticks the
      // "Opening Google…" button so a retry tap actually works.
      setBusy(false);
    }
  };
  return (
    <button
      data-testid="google-login-btn"
      onClick={onClick}
      disabled={busy}
      className="w-full cc-btn-secondary flex items-center justify-center gap-3 disabled:opacity-50"
    >
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 43.5c5.4 0 10.3-2 14-5.3l-6.5-5.3C29.4 34.4 26.8 35.5 24 35.5c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39 16.2 43.5 24 43.5z"/>
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4 5.5l6.5 5.3C41.5 35.7 43.5 30.2 43.5 24c0-1.2-.1-2.3-.4-3.5z"/>
      </svg>
      <span>{busy ? "Opening Google…" : (extra || "Continue with Google")}</span>
    </button>
  );
}

export default function Login() {
  const { user, login, loginWithSupabaseEmail, loginWithSupabaseGoogle } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // If a session lands here (e.g. returning from the Google OAuth redirect,
  // which we point at this public /login route so the ?code= isn't dropped),
  // forward the now-authenticated user into the app.
  useEffect(() => {
    if (user) nav("/feed", { replace: true });
  }, [user, nav]);

  // Explicit OAuth code exchange. Google returns to /login?code=… (PKCE). We
  // exchange it here rather than relying on detectSessionInUrl, so that if the
  // code-verifier is missing/expired (reused link, or the flow started on a
  // different origin) we show a clear error and restart the flow ONCE — instead
  // of silently rendering this "Welcome back" screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthError = params.get("error_description") || params.get("error");
    const cleanUrl = () => { try { window.history.replaceState({}, "", "/login"); } catch { /* ignore */ } };

    if (oauthError) {
      cleanUrl();
      setErr(`Google sign-in was cancelled or failed: ${oauthError}`);
      return;
    }
    if (!code) return;

    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const supa = await getSupabase();
        await supa.auth.exchangeCodeForSession(code);
        cleanUrl();
        sessionStorage.removeItem("cc_oauth_retry");
        // AuthContext's onSupabaseAuth picks up SIGNED_IN, swaps it for a
        // ClanChat JWT and sets `user`; the effect above then routes to /feed.
      } catch (e) {
        if (cancelled) return;
        cleanUrl();
        const msg = (e?.message || "").toLowerCase();
        const verifierIssue =
          msg.includes("verifier") || msg.includes("pkce") ||
          msg.includes("code challenge") || msg.includes("invalid request") ||
          msg.includes("auth code and code verifier");
        if (verifierIssue && !sessionStorage.getItem("cc_oauth_retry")) {
          // One automatic restart from this canonical origin (fresh verifier).
          sessionStorage.setItem("cc_oauth_retry", "1");
          setErr("Reconnecting to Google…");
          try { await loginWithSupabaseGoogle(); return; } catch { /* fall through */ }
        }
        sessionStorage.removeItem("cc_oauth_retry");
        setErr("Google sign-in didn't complete. Please tap Continue with Google again.");
        setBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Legacy ClanChat login FIRST — it's the authoritative store for
   * email/password accounts and is a single fast round-trip. Only if the
   * credentials are rejected there do we try Supabase (covers accounts that
   * exist only in Supabase). This removes the slow, wasted Supabase round-trip
   * that every legacy/seeded user used to pay on each sign-in.
   */
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await login(email, password);
      toast.success("Welcome back");
      nav("/feed", { replace: true });
      return;
    } catch (legacyErr) {
      const status = legacyErr?.response?.status;
      // Only fall through to Supabase when legacy says "bad credentials"
      // (400/401/404). Genuine server/network errors are surfaced as-is.
      if (status && ![400, 401, 404].includes(status)) {
        setErr(formatApiError(legacyErr.response?.data?.detail) || legacyErr.message);
        setBusy(false);
        return;
      }
    }
    // Supabase fallback (Supabase-only / migrated accounts).
    try {
      await loginWithSupabaseEmail(email, password);
      toast.success("Welcome back");
      nav("/feed", { replace: true });
    } catch (sbErr) {
      const detail = formatApiError(sbErr?.response?.data?.detail);
      const raw = (sbErr?.message || "").toLowerCase();
      // Both stores rejected the credentials → show a single clear message.
      const isAuthFail =
        !sbErr?.response || [400, 401, 404].includes(sbErr?.response?.status) ||
        raw.includes("invalid") || raw.includes("credential") ||
        raw.includes("no supabase session");
      setErr(isAuthFail ? "Invalid email or password." : (detail || sbErr?.message || "Invalid email or password."));
    } finally { setBusy(false); }
  };

  return (
    <div className="px-6 pt-16 pb-24 min-h-screen flex flex-col">
      <div className="mb-10">
        <Link to="/" className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">ClanChat</Link>
        <h1 className="font-heading text-4xl mt-3">Welcome back</h1>
        <p className="text-zinc-500 mt-2 text-sm">Sign in to your clubhouse.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3" autoComplete="on">
        <input
          data-testid="login-email"
          name="username"
          autoComplete="email"
          className="cc-input"
          type="email" placeholder="Email"
          value={email} onChange={e => setEmail(e.target.value)} required
        />
        
        {/* Password input container with integrated toggle button */}
        <div className="relative w-full">
          <input
            data-testid="login-password"
            name="password"
            autoComplete="current-password"
            className="cc-input pr-12 w-full"
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            tabIndex="-1"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 p-1 z-10"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="w-5 h-5" />
            ) : (
              <Eye className="w-5 h-5" />
            )}
          </button>
        </div>

        {err && <div className="text-sm text-red-400" data-testid="login-error">{err}</div>}
        <button
          data-testid="login-submit"
          className="cc-btn-primary mt-2" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <Link
          to="/forgot-password"
          data-testid="forgot-password-link"
          className="text-xs text-zinc-500 hover:text-[#FF5A00] mt-1 self-end"
        >
          Forgot password?
        </Link>
      </form>
      <div className="flex items-center gap-3 my-6 text-zinc-600 text-xs uppercase tracking-[0.2em]">
        <div className="flex-1 h-px bg-zinc-900" /> or <div className="flex-1 h-px bg-zinc-900" />
      </div>
      <GoogleButton />
      <p className="text-center text-sm text-zinc-500 mt-8">
        New here?{" "}
        <Link to="/register" className="text-[#FF5A00] hover:underline" data-testid="register-link">Create account</Link>
      </p>
    </div>
  );
}

export { GoogleButton };

