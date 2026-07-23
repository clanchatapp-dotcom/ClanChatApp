import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { rememberToken, forgetToken } from "../lib/api";
import {
  fbSignInEmail,
  fbSignUpEmail,
  fbSignInGoogle,
  fbGetRedirectResult,
  fbSignOut as firebaseSignOut,
  fbGetIdToken,
  fbSendPasswordReset,
  onFirebaseIdTokenRefresh,
} from "../lib/firebase";

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
    // Also sign out of Firebase so the client-side session persistence
    // (indexedDB / localStorage) is cleared. Otherwise the next visit
    // silently re-authenticates the user via the cached Firebase session.
    try { await firebaseSignOut(); } catch { /* noop */ }
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
  // Firebase-powered sign-in helpers.
  //
  // Flow: authenticate against Firebase → grab the fresh ID token →
  // exchange it for a ClanChat JWT via /api/auth/firebase-login → set
  // the user on the context. The internal JWT is still what the rest
  // of the app uses for API calls, so we don't have to touch the
  // axios interceptor or the ~200 backend Depends(get_current_user)
  // callsites.
  //
  // For brand-new Firebase users the backend replies with
  // { needs_profile: true, firebase_email, firebase_name } so the caller
  // can prompt for DOB + handle and re-submit with those fields.
  // ------------------------------------------------------------------
  const exchangeFirebaseToken = useCallback(async ({ dob, handle } = {}) => {
    const id_token = await fbGetIdToken(true); // force refresh
    if (!id_token) throw new Error("No Firebase session");
    const { data } = await api.post("/auth/firebase-login", {
      id_token, dob, handle,
    });
    if (data.needs_profile) return data; // caller must collect DOB/handle
    if (data.access_token) await rememberToken(data.access_token);
    setUser(data.user);
    return data;
  }, []);

  const loginWithFirebaseEmail = useCallback(async (email, password) => {
    await fbSignInEmail(email, password);
    return exchangeFirebaseToken();
  }, [exchangeFirebaseToken]);

  const registerWithFirebaseEmail = useCallback(async (email, password, dob, handle) => {
    await fbSignUpEmail(email, password);
    return exchangeFirebaseToken({ dob, handle });
  }, [exchangeFirebaseToken]);

  const loginWithFirebaseGoogle = useCallback(async () => {
    const popupResult = await fbSignInGoogle();
    // If we did a redirect (mobile / native path), the actual result
    // arrives asynchronously via getRedirectResult on the next load —
    // handled by the useEffect below.
    if (!popupResult) return null;
    return exchangeFirebaseToken();
  }, [exchangeFirebaseToken]);

  const requestFirebasePasswordReset = useCallback(async (email) => {
    return fbSendPasswordReset(email);
  }, []);

  // On mount, complete any pending Firebase redirect sign-in (Google on
  // mobile / native) and exchange the resulting ID token for a ClanChat
  // JWT. Also register an ID-token refresh listener so long-lived
  // sessions transparently re-mint the internal JWT before it expires.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fbGetRedirectResult();
        if (res?.user && !cancelled) {
          try { await exchangeFirebaseToken(); } catch (e) { console.warn("fb redirect exchange failed", e); }
        }
      } catch { /* no pending redirect */ }
    })();
    const unsub = onFirebaseIdTokenRefresh(async (fbUser) => {
      if (!fbUser) return;
      try { await exchangeFirebaseToken(); } catch (e) { console.warn("fb id-token refresh exchange failed", e); }
    });
    return () => { cancelled = true; unsub(); };
  }, [exchangeFirebaseToken]);

  return (
    <AuthContext.Provider value={{
      user, setUser,
      login, register, logout, refresh,
      loginWithFirebaseEmail, registerWithFirebaseEmail,
      loginWithFirebaseGoogle, requestFirebasePasswordReset,
      theme, setTheme,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
