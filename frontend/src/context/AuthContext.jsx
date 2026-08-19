import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import api, { rememberToken, forgetToken, getToken } from "../lib/api";
import {
  getSupabase,
  sbSignInEmail,
  sbSignUpEmail,
  sbSignInGoogle,
  sbSignOut as supabaseSignOut,
  sbGetAccessToken,
  sbGetSession,
  sbSendPasswordReset,
  onSupabaseAuth,
} from "../lib/supabase";
import { consumeOAuthCode, hasOAuthCodeInUrl } from "../lib/oauthExchange";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Hydrate from localStorage so cold starts don't flash the login page.
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem("cc_last_user");
      return raw ? JSON.parse(raw) : undefined;
    } catch { return undefined; }
  });

  // FLICKER FIX -------------------------------------------------------
  // `bootstrapping` is true until the ONE startup sequence below has
  // finished (OAuth code exchange -> Supabase session -> /auth/me).
  // Previously three independent effects raced and each wrote `user`:
  //   checkAuth() -> user=null  (401, no ClanChat JWT yet)
  //   OAuth exchange -> user={...}
  //   onSupabaseAuth SIGNED_IN -> user={...} again
  // Every flip remounted the whole protected tree and bounced the router
  // between /feed and /login -> the visible flicker. Routes must now render
  // a stable "Loading…" while `bootstrapping` is true and never redirect.
  const [bootstrapping, setBootstrapping] = useState(true);

  const [theme, setTheme] = useState(() => localStorage.getItem("cc_theme") || "dark");
  const [pendingProfile, setPendingProfile] = useState(null);

  useEffect(() => {
    try {
      if (user) localStorage.setItem("cc_last_user", JSON.stringify(user));
      else if (user === null) localStorage.removeItem("cc_last_user");
    } catch { /* private mode */ }
  }, [user]);

  const checkAuth = useCallback(async () => {
    if (window.location.hash?.includes("session_id=")) return; // AuthCallback owns this
    // NOTE: the old 2500ms `?code=` sleep is gone. The bootstrap sequence
    // below now *awaits* the OAuth exchange before calling checkAuth, so
    // there is nothing left to race against.
    const attempt = () => api.get("/auth/me").then(r => r.data);
    let data = null;
    let firstErr = null;
    try {
      data = await attempt();
    } catch (err) {
      firstErr = err;
      if (err?.response?.status === 401) {
        const persisted = await getToken();
        if (persisted) {
          await new Promise((r) => setTimeout(r, 400));
          try { data = await attempt(); firstErr = null; } catch (err2) { firstErr = err2; }
        }
      }
    }
    if (data) { setUser(data); return data; }
    const status = firstErr?.response?.status;
    if (status === 401 || status === 403) {
      await forgetToken();
      // Only set null if we're not already bootstrapping
      // to prevent the redirect loop
      if (!bootstrapping) setUser(null);
    } else {
      // Network blip / 5xx: keep whatever we have rather than wiping.
      setUser((prev) => (prev === undefined ? null : prev));
    }
    return null;
  }, [bootstrapping]);

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
  // Supabase session -> ClanChat JWT exchange.
  // De-duplicated: onAuthStateChange fires SIGNED_IN *and* TOKEN_REFRESHED
  // right after the code exchange, and each used to POST /auth/supabase-login
  // and setUser again (more flicker, and a race that could resurrect a
  // stale pendingProfile). One in-flight exchange at a time.
  // ------------------------------------------------------------------
  const inFlightExchange = useRef(null);
  const exchangeSupabaseToken = useCallback(async ({ dob, handle } = {}) => {
    const isProfileSubmit = Boolean(dob || handle);
    if (!isProfileSubmit && inFlightExchange.current) return inFlightExchange.current;

    const run = (async () => {
      const access_token = await sbGetAccessToken();
      if (!access_token) throw new Error("No Supabase session");
      const { data } = await api.post("/auth/supabase-login", { access_token, dob, handle });
      if (data.needs_profile) {
        setPendingProfile({
          email: data.supabase_email || "",
          name: data.supabase_name || "",
        });
        return data;
      }
      if (data.access_token) await rememberToken(data.access_token, data.refresh_token);
      setPendingProfile(null);
      setUser(data.user);
      return data;
    })();

    if (!isProfileSubmit) {
      inFlightExchange.current = run;
      run.finally(() => { inFlightExchange.current = null; }).catch(() => {});
    }
    return run;
  }, []);

  const completeSupabaseProfile = useCallback(
    (dob, handle) => exchangeSupabaseToken({ dob, handle }),
    [exchangeSupabaseToken],
  );

  const loginWithSupabaseEmail = useCallback(async (email, password) => {
    await sbSignInEmail(email, password);
    return exchangeSupabaseToken();
  }, [exchangeSupabaseToken]);

  const registerWithSupabaseEmail = useCallback(async (email, password, dob, handle) => {
    await sbSignUpEmail(email, password);
    return exchangeSupabaseToken({ dob, handle });
  }, [exchangeSupabaseToken]);

  const loginWithSupabaseGoogle = useCallback(async () => {
    await sbSignInGoogle();
    return null;
  }, []);

  const requestSupabasePasswordReset = useCallback((email) => sbSendPasswordReset(email), []);

  // ------------------------------------------------------------------
  // THE single startup sequence. Strictly ordered, never racing.
  //   1. consume the PKCE ?code= (module-level guard: exactly once ever)
  //   2. if a Supabase session exists -> swap it for a ClanChat JWT
  //   3. otherwise -> /auth/me for legacy JWT sessions
  //   4. bootstrapping = false  (routes may now redirect)
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await consumeOAuthCode();
      if (result.status === "error" && !cancelled) {
        // Surface it and STOP. We deliberately do NOT auto-retry
        // signInWithOAuth() here — that retry was what produced the
        // Google -> app -> Google redirect loop.
        toast.error(result.message);
      }

      let session = null;
      try { session = await sbGetSession(); } catch { /* not configured */ }

      if (session) {
        try {
          await exchangeSupabaseToken();
        } catch (e) {
          console.warn("supabase -> clanchat exchange failed", e);
          if (!cancelled) await checkAuth();
        }
      } else {
        await checkAuth();
      }

      if (!cancelled) setBootstrapping(false);
    })();

    return () => { cancelled = true; };
    // Intentionally mount-only: this is a one-shot bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Later auth changes only (token refresh, sign-in from another tab).
  // Skipped while bootstrapping so it can't double-exchange on startup.
  useEffect(() => {
    if (bootstrapping) return undefined;
    const unsub = onSupabaseAuth(async (session) => {
      if (!session) return;
      try { await exchangeSupabaseToken(); } catch (e) { console.warn("sb auth-change exchange failed", e); }
    });
    return unsub;
  }, [bootstrapping, exchangeSupabaseToken]);

  // Capacitor: re-verify when the app returns to the foreground.
  useEffect(() => {
    if (bootstrapping) return undefined;
    let handleRef;
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor?.isNativePlatform?.()) return;
        const { App } = await import("@capacitor/app");
        handleRef = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive && !cancelled) setTimeout(() => { checkAuth(); }, 300);
        });
      } catch { /* web */ }
    })();
    return () => {
      cancelled = true;
      try { handleRef?.remove?.(); } catch { /* ignore */ }
    };
  }, [bootstrapping, checkAuth]);

  // Capacitor deep-link return: clanchat://auth-callback?code=…
  useEffect(() => {
    let handleRef;
    let cancelled = false;

    const handleUrl = async (url) => {
      if (cancelled || !url || !url.startsWith("clanchat://")) return;
      let Browser = null;
      try { Browser = (await import("@capacitor/browser")).Browser; } catch { /* optional */ }
      try { await Browser?.close?.(); } catch { /* ignore */ }
      try {
        const supa = await getSupabase();
        const qIndex = url.indexOf("?");
        const hIndex = url.indexOf("#");
        const query = qIndex >= 0 ? url.slice(qIndex + 1).split("#")[0] : "";
        const hash = hIndex >= 0 ? url.slice(hIndex + 1) : "";
        const params = new URLSearchParams(query || hash);
        const hashParams = new URLSearchParams(hash);
        const err = params.get("error") || hashParams.get("error");
        if (err) {
          toast.error(`Google sign-in failed: ${params.get("error_description") || hashParams.get("error_description") || err}`);
          return;
        }
        const access = params.get("access_token") || hashParams.get("access_token");
        const refresh = params.get("refresh_token") || hashParams.get("refresh_token");
        const code = params.get("code");
        if (code) {
          await supa.auth.exchangeCodeForSession(code); // single use, never retried
        } else if (access && refresh) {
          await supa.auth.setSession({ access_token: access, refresh_token: refresh });
        } else {
          toast.error("Google returned no sign-in code. Please try again.");
          return;
        }
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await exchangeSupabaseToken(); lastErr = null; break; }
          catch (retryErr) {
            lastErr = retryErr;
            if (retryErr?.response?.status && retryErr.response.status < 500) break;
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
        try {
          const launch = await App.getLaunchUrl();
          if (launch?.url) handleUrl(launch.url);
        } catch { /* ignore */ }
        handleRef = await App.addListener("appUrlOpen", ({ url }) => handleUrl(url));
      } catch { /* web */ }
    })();

    return () => {
      cancelled = true;
      try { handleRef?.remove?.(); } catch { /* ignore */ }
    };
  }, [exchangeSupabaseToken]);

  return (
    <AuthContext.Provider value={{
      user, setUser,
      bootstrapping,
      // True while the browser is still finishing a Google return.
      oauthPending: bootstrapping && hasOAuthCodeInUrl(),
      login, register, logout, refresh, checkAuth,
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

