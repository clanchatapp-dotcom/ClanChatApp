import { createContext, useContext, useEffect, useState, useCallback } from "react";
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

  // Persist the user snapshot so the next cold start hydrates instantly.
  useEffect(() => {
    try {
      if (user) localStorage.setItem("cc_last_user", JSON.stringify(user));
      else if (user === null) localStorage.removeItem("cc_last_user");
    } catch { /* private mode / storage disabled */ }
  }, [user]);

  // -------------------- Token refresh scheduling ----------------------
  let refreshTimer = null;
  const clearRefreshTimer = () => { if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; } };

  function parseJwtExp(token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload.exp ? payload.exp * 1000 : null; // ms
    } catch { return null; }
  }

  function scheduleRefreshForToken(token) {
    try {
      clearRefreshTimer();
      if (!token) return;
      const expMs = parseJwtExp(token);
      if (!expMs) return;
      // refresh 60s before expiry
      const msUntilRefresh = expMs - Date.now() - 60_000;
      const delay = Math.max(msUntilRefresh, 0);
      refreshTimer = setTimeout(async () => {
        try {
          // Prefer re-exchanging the Supabase session for a fresh internal JWT
          await exchangeSupabaseToken().catch(async () => {
            // If exchange fails, optionally call a server refresh endpoint here
            // await api.post('/auth/refresh');
          });
        } catch (e) {
          console.warn("scheduled token refresh failed", e);
        } finally { clearRefreshTimer(); }
      }, delay);
    } catch (e) { console.warn("scheduleRefreshForToken failed", e); }
  }

  // ------------------------------------------------------------------
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
      clearRefreshTimer();
      setUser(null);
    } else {
      // Network error / 5xx / CORS blip / brief offline after Android
      // resume: keep whatever user state we already have. Don't wipe
      // token — the next mount will try again.
      setUser((prev) => (prev === undefined ? null : prev));
    }
  }, []);

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
            setTimeout(async () => {
              try {
                // Try to rehydrate Supabase session first — this avoids a
                // premature /auth/me 401 when Preferences is still warming up.
                const sess = await sbGetSession();
                if (sess) {
                  try { await exchangeSupabaseToken(); return; } catch (e) { console.warn("sb re-exchange failed", e); }
                }
              } catch (e) { /* ignore */ }
              checkAuth();
            }, 300);
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
    if (data.access_token) {
      await rememberToken(data.access_token);
      scheduleRefreshForToken(data.access_token);
    }
    setUser(data.user);
    return data.user;
  };
  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    if (data.access_token) {
      await rememberToken(data.access_token);
      scheduleRefreshForToken(data.access_token);
    }
    setUser(data.user);
    return data.user;
  };
  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (e) { console.warn("logout failed", e); }
    // Also sign out of Supabase so the browser-side session doesn't
    // silently re-authenticate the user on next visit.
    try { await supabaseSignOut(); } catch { /* noop */ }
    await forgetToken();
    clearRefreshTimer();
    try { localStorage.removeItem("cc_last_user"); } catch { /* ignore */ }
    setUser(null);
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
    if (data.needs_profile) return data; // caller must collect DOB/handle
    if (data.access_token) {
      await rememberToken(data.access_token);
      scheduleRefreshForToken(data.access_token);
    }
    setUser(data.user);
    return data;
  }, []);

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

  return (
    <AuthContext.Provider value={{
      user, setUser,
      login, register, logout, refresh,
      loginWithSupabaseEmail, registerWithSupabaseEmail,
      loginWithSupabaseGoogle, requestSupabasePasswordReset,
      theme, setTheme,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
