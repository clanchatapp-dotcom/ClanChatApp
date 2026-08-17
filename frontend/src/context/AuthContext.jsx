import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import api, { rememberToken, forgetToken, getToken } from "../lib/api";
import {
  sbSignInEmail,
  sbSignUpEmail,
  sbSignInGoogle,
  sbSignOut as supabaseSignOut,
  sbGetAccessToken,
  sbGetSession,
  sbSendPasswordReset,
  onSupabaseAuth,
} from "../lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Hydrate from localStorage on first render so cold starts don't flash
  // the login page while /auth/me is in-flight. Any transient network hiccup
  // that would otherwise blank the app now sees the last-known user and
  // /auth/me confirms or clears it. Only cleared on a real 401/403 or logout.
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem("cc_last_user");
      return raw ? JSON.parse(raw) : undefined;
    } catch { return undefined; }
  });
  const [theme, setTheme] = useState(() => localStorage.getItem("cc_theme") || "dark");
  // When a brand-new Supabase (Google/email) user authenticates but has no
  // ClanChat profile yet, the backend replies { needs_profile: true, ... }.
  // We stash that here so a global "Complete profile" screen can collect the
  // required # handle + DOB, then finish the exchange. Without this, Google
  // sign-in would authenticate against Supabase but never create the account.
  const [pendingProfile, setPendingProfile] = useState(null);

  // Persist the user snapshot so the next cold start hydrates instantly.
  useEffect(() => {
    try {
      if (user) localStorage.setItem("cc_last_user", JSON.stringify(user));
      else if (user === null) localStorage.removeItem("cc_last_user");
    } catch { /* private mode / storage disabled */ }
  }, [user]);

  const checkAuth = useCallback(async () => {
    if (window.location.hash?.includes("session_id=")) {
      // Let AuthCallback handle
      return;
    }
    // Iter 26 fix — the APK was logging users out after a few minutes of
    // inactivity because Capacitor Preferences occasionally returns
    // `{value:null}` right after a WebView resume, the request went out
    // without a Bearer header, `/auth/me` returned 401, and this handler
    // wiped the token. To avoid that:
    //   1. Retry /auth/me ONCE with a small delay if the first attempt
    //      returns 401 AND we still have a persisted token — that gives
    //      the Preferences plugin time to warm up.
    //   2. Only forgetToken() on a definitive 401 after both attempts.
    const attempt = () => api.get("/auth/me").then(r => r.data);
    let data = null;
    let firstErr = null;
    try {
      data = await attempt();
    } catch (err) {
      firstErr = err;
      const status = err?.response?.status;
      // Retry on 401 only if we still have a persisted token — otherwise
      // this really is an unauthenticated session and we shouldn't spam.
      if (status === 401) {
        const persisted = await getToken();
        if (persisted) {
          await new Promise((r) => setTimeout(r, 400));
          try {
            data = await attempt();
            firstErr = null;
          } catch (err2) { firstErr = err2; }
        }
      }
    }
    if (data) {
      setUser(data);
      return;
    }
    const status = firstErr?.response?.status;
    if (status === 401 || status === 403) {
      await forgetToken();
      setUser(null);
    } else {
      // Network error / 5xx / CORS blip / brief offline after Android
      // resume: keep whatever user state we already have. Don't wipe
      // token — the next mount will try again.
      setUser((prev) => (prev === undefined ? null : prev));
    }
  }, []);

  // Iter 30 — Google OAuth on the Capacitor APK.
  // OAuth opens in Chrome Custom Tabs and redirects to
  // `clanchat://auth-callback#access_token=…&refresh_token=…`. Android
  // routes that URL to the app via the intent filter; we grab it here,
  // hand the tokens to Supabase, then exchange for a ClanChat JWT.
  // (See useEffect below `exchangeSupabaseToken` — moved to avoid TDZ.)

  useEffect(() => { checkAuth(); }, [checkAuth]);

  // Iter 26 — Android/Capacitor: when the app returns from background,
  // re-run checkAuth so we sync any state that might have drifted while
  // the WebView was paused (e.g. token was rotated by another device,
  // or the OS killed a stale request mid-flight). Web is a no-op.
  useEffect(() => {
    let handleRef;
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor?.isNativePlatform?.()) return;
        const { App } = await import("@capacitor/app");
        handleRef = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive && !cancelled) {
            // Small debounce so we don't fight the WebView unpause.
            setTimeout(() => { checkAuth(); }, 300);
          }
        });
      } catch { /* plugin not available on web */ }
    })();
    return () => {
      cancelled = true;
      try { handleRef?.remove?.(); } catch { /* ignore */ }
    };
  }, [checkAuth]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") root.classList.add("light");
    else root.classList.remove("light");
    localStorage.setItem("cc_theme", theme);
  }, [theme]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.access_token) await rememberToken(data.access_token, data.refresh_token);
    setUser(data.user);
    return data.user;
  };
  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    if (data.access_token) await rememberToken(data.access_token, data.refresh_token);
    setUser(data.user);
    return data.user;
  };
  const logout = async () => {
    // Clear local auth state IMMEDIATELY so the UI responds instantly and
    // sign-out can never hang. Previously we awaited the server logout AND
    // supabaseSignOut() (both network calls) before clearing state — on
    // mobile / slow networks those stalled, so the Sign out button appeared
    // to "do nothing". The remote cleanups are best-effort, fire-and-forget.
    await forgetToken();
    try { localStorage.removeItem("cc_last_user"); } catch { /* ignore */ }
    setPendingProfile(null);
    setUser(null);
    api.post("/auth/logout").catch(() => {});
    Promise.resolve().then(() => supabaseSignOut()).catch(() => {});
  };
  const refresh = async () => {
    const { data } = await api.get("/auth/me");
    setUser(data);
    return data;
  };

  // ------------------------------------------------------------------
  // Supabase-powered sign-in helpers.
  //
  // Flow: authenticate against Supabase → grab the fresh access token →
  // exchange it for a ClanChat JWT via /api/auth/supabase-login → set
  // the user on the context. The internal JWT is still what the rest
  // of the app uses for API calls, so we don't touch the axios
  // interceptor or the ~200 backend Depends(get_current_user) sites.
  //
  // For brand-new Supabase users the backend replies with
  // { needs_profile: true, supabase_email, supabase_name } so the caller
  // can prompt for DOB + handle and re-submit with those fields.
  // ------------------------------------------------------------------
  const exchangeSupabaseToken = useCallback(async ({ dob, handle } = {}) => {
    const access_token = await sbGetAccessToken();
    if (!access_token) throw new Error("No Supabase session");
    const { data } = await api.post("/auth/supabase-login", {
      access_token, dob, handle,
    });
    if (data.needs_profile) {
      // Surface the "complete profile" screen. Keep the email/name so the
      // UI can greet the user by name while they pick a handle + DOB.
      setPendingProfile({
        email: data.supabase_email || "",
        name: data.supabase_name || "",
      });
      return data; // caller must collect DOB/handle
    }
    if (data.access_token) await rememberToken(data.access_token, data.refresh_token);
    setPendingProfile(null);
    setUser(data.user);
    return data;
  }, []);

  // Called by the CompleteProfile screen once the user supplies handle + DOB.
  const completeSupabaseProfile = useCallback(async (dob, handle) => {
    return exchangeSupabaseToken({ dob, handle });
  }, [exchangeSupabaseToken]);

  const loginWithSupabaseEmail = useCallback(async (email, password) => {
    await sbSignInEmail(email, password);
    return exchangeSupabaseToken();
  }, [exchangeSupabaseToken]);

  const registerWithSupabaseEmail = useCallback(async (email, password, dob, handle) => {
    await sbSignUpEmail(email, password);
    return exchangeSupabaseToken({ dob, handle });
  }, [exchangeSupabaseToken]);

  const loginWithSupabaseGoogle = useCallback(async () => {
    // OAuth redirect kicks the browser to Google. On return the Supabase
    // SDK auto-hydrates the session and the useEffect below picks up
    // SIGNED_IN and exchanges the token.
    await sbSignInGoogle();
    return null;
  }, []);

  const requestSupabasePasswordReset = useCallback(async (email) => {
    return sbSendPasswordReset(email);
  }, []);

  // On mount, hydrate any pending Supabase session (fresh OAuth redirect
  // or a returning user with persisted localStorage session) and swap it
  // for a ClanChat JWT. Also listen for SIGNED_IN / TOKEN_REFRESHED so
  // long sessions silently re-mint the internal JWT.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sess = await sbGetSession();
        if (sess && !cancelled) {
          try { await exchangeSupabaseToken(); } catch (e) { console.warn("sb initial exchange failed", e); }
        }
      } catch { /* no session */ }
    })();
    const unsub = onSupabaseAuth(async (session) => {
      if (!session) return;
      try { await exchangeSupabaseToken(); } catch (e) { console.warn("sb auth-change exchange failed", e); }
    });
    return () => { cancelled = true; unsub(); };
  }, [exchangeSupabaseToken]);

  // Google OAuth deep-link handler for the Capacitor APK.
  // OAuth opens in Chrome Custom Tabs and redirects to
  // `clanchat://auth-callback?code=…` (PKCE). Android routes that URL back
  // into the app via the intent filter; we grab the code, feed it into
  // Supabase (exchangeCodeForSession), then swap it for a ClanChat JWT.
  // Failures are surfaced on screen (toast) so a broken return is visible
  // instead of a silent bounce back to the sign-up page.
  useEffect(() => {
    let handleRef;
    let cancelled = false;

    const handleUrl = async (url) => {
      if (cancelled || !url || !url.startsWith("clanchat://")) return;
      let Browser = null;
      try { Browser = (await import("@capacitor/browser")).Browser; } catch { /* optional */ }
      try { await Browser?.close?.(); } catch { /* ignore */ }
      try {
        const supa = await (await import("../lib/supabase")).getSupabase();
        // Params can arrive in the query (?code=…, PKCE) or, defensively,
        // the fragment (#access_token=…). Parse both.
        const qIndex = url.indexOf("?");
        const hIndex = url.indexOf("#");
        const query = qIndex >= 0 ? url.slice(qIndex + 1).split("#")[0] : "";
        const hash = hIndex >= 0 ? url.slice(hIndex + 1) : "";
        const params = new URLSearchParams(query || hash);
        const hashParams = new URLSearchParams(hash);
        const err = params.get("error") || hashParams.get("error");
        const errDesc = params.get("error_description") || hashParams.get("error_description");
        if (err) {
          toast.error(`Google sign-in failed: ${errDesc || err}`);
          return;
        }
        const access = params.get("access_token") || hashParams.get("access_token");
        const refresh = params.get("refresh_token") || hashParams.get("refresh_token");
        const code = params.get("code");
        if (code) {
          // Single-use PKCE code — never retry this call, a second attempt
          // with the same code will always fail.
          await supa.auth.exchangeCodeForSession(code);
        } else if (access && refresh) {
          await supa.auth.setSession({ access_token: access, refresh_token: refresh });
        } else {
          toast.error("Google returned no sign-in code. Please try again.");
          return;
        }
        // exchangeSupabaseToken() only talks to our own backend and is
        // idempotent (same Supabase access token each attempt), unlike the
        // single-use code exchange above — safe to retry on a transient
        // network blip instead of surfacing a one-off "network error".
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await exchangeSupabaseToken();
            lastErr = null;
            break;
          } catch (retryErr) {
            lastErr = retryErr;
            const status = retryErr?.response?.status;
            if (status && status < 500) break; // real rejection, not a network blip
            if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
        if (lastErr) throw lastErr;
      } catch (e) {
        const msg = e?.response?.data?.detail || e?.message || String(e);
        toast.error(`Couldn't finish Google sign-in: ${typeof msg === "string" ? msg : "unknown error"}`);
        console.warn("google deep-link auth failed", e);
      }
    };

    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor?.isNativePlatform?.()) return;
        const { App } = await import("@capacitor/app");
        // Cold-start: if Android killed the backgrounded app while Google was
        // open, the appUrlOpen event fires before this listener exists — so
        // also check the URL the app was launched with.
        try {
          const launch = await App.getLaunchUrl();
          if (launch?.url) handleUrl(launch.url);
        } catch { /* ignore */ }
        handleRef = await App.addListener("appUrlOpen", ({ url }) => handleUrl(url));
      } catch { /* plugin missing on web */ }
    })();

    return () => {
      cancelled = true;
      try { handleRef?.remove?.(); } catch { /* ignore */ }
    };
  }, [exchangeSupabaseToken]);

  return (
    <AuthContext.Provider value={{
      user, setUser,
      login, register, logout, refresh,
      loginWithSupabaseEmail, registerWithSupabaseEmail,
      loginWithSupabaseGoogle, requestSupabasePasswordReset,
      pendingProfile, completeSupabaseProfile, setPendingProfile,
      theme, setTheme,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
