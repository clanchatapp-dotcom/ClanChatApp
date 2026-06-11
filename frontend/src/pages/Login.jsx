import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { formatApiError } from "../lib/api";
import { toast } from "sonner";

function GoogleButton({ extra }) {
  return (
    <button
      data-testid="google-login-btn"
      onClick={() => {
        // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
        const redirectUrl = window.location.origin + "/feed";
        window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      }}
      className="w-full cc-btn-secondary flex items-center justify-center gap-3"
    >
      <svg width="18" height="18" viewBox="0 0 48 48">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 43.5c5.4 0 10.3-2 14-5.3l-6.5-5.3C29.4 34.4 26.8 35.5 24 35.5c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39 16.2 43.5 24 43.5z"/>
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4 5.5l6.5 5.3C41.5 35.7 43.5 30.2 43.5 24c0-1.2-.1-2.3-.4-3.5z"/>
      </svg>
      <span>{extra || "Continue with Google"}</span>
    </button>
  );
}

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await login(email, password);
      toast.success("Welcome back");
      nav("/feed", { replace: true });
    } catch (e) {
      setErr(formatApiError(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="px-6 pt-16 pb-24 min-h-screen flex flex-col">
      <div className="mb-10">
        <Link to="/" className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">ClanChat</Link>
        <h1 className="font-heading text-4xl mt-3">Welcome back</h1>
        <p className="text-zinc-500 mt-2 text-sm">Sign in to your clubhouse.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          data-testid="login-email"
          autoComplete="email"
          className="cc-input"
          type="email" placeholder="Email"
          value={email} onChange={e => setEmail(e.target.value)} required
        />
        <input
          data-testid="login-password"
          autoComplete="current-password"
          className="cc-input"
          type="password" placeholder="Password"
          value={password} onChange={e => setPassword(e.target.value)} required
        />
        {err && <div className="text-sm text-red-400" data-testid="login-error">{err}</div>}
        <button
          data-testid="login-submit"
          className="cc-btn-primary mt-2" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
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
