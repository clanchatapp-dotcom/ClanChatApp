import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { rememberToken, forgetToken } from "../lib/api";
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

  const checkAuth = useCallback(async () => {
    if (window.location.hash?.includes("session_id=")) {
      // Let AuthCallback handle
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (err) {
      // Only clear the session on an explicit 401/403 from the backend.
      // Anything else (network failure, timeout, 500, CORS blip while the
      // backend is redeploying, brief offline moment when Android returns
      // from background) is treated as "unknown" — keep whatever user state
      // we already have. This stops the app from randomly logging users
      // out whenever a request fails for reasons unrelated to auth.
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        await forgetToken();
        setUser(null);
      } else {
        setUser((prev) => (prev === undefined ? null : prev));
      }
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") root.classList.add("light");
    else root.classList.remove("light");
    localStorage.setItem("cc_theme", theme);
  }, [theme]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.access_token) await rememberToken(data.access_token);
    setUser(data.user);
    return data.user;
  };
  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    if (data.access_token) await rememberToken(data.access_token);
    setUser(data.user);
    return data.user;
  };
  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (e) { console.warn("logout failed", e); }
    // Also sign out of Supabase so the browser-side session doesn't
    // silently re-authenticate the user on next visit.
    try { await supabaseSignOut(); } catch { /* noop */ }
    await forgetToken();
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
    if (data.access_token) await rememberToken(data.access_token);
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
