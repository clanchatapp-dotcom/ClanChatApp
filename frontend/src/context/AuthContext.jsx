import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
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
  // Hydrate from localStorage on first render so cold starts don't flash login page.
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem("cc_last_user");
      return raw ? JSON.parse(raw) : undefined;
    } catch { return undefined; }
  });
  const [theme, setTheme] = useState(() => localStorage.getItem("cc_theme") || "dark");
  const [pendingProfile, setPendingProfile] = useState(null);

  // Persist user snapshot for cold starts
  useEffect(() => {
    try {
      if (user) localStorage.setItem("cc_last_user", JSON.stringify(user));
      else if (user === null) localStorage.removeItem("cc_last_user");
    } catch { /* private mode / storage disabled */ }
  }, [user]);

  const checkAuth = useCallback(async () => {
    // FIX: Pause /auth/me if returning from Google OAuth redirect so checkAuth
    // doesn't wipe the user state before exchangeSupabaseToken handles the callback.
    if (
      window.location.hash?.includes("session_id=") ||
      window.location.hash?.includes("access_token=") ||
      window.location.search?.includes("code=")
    ) {
      return;
    }

    const attempt = () => api.get("/auth/me").then(r => r.data);
    let data = null;
    let firstErr = null;
    try {
      data = await attempt();
    } catch (err) {
      firstErr = err;
      const status = err?.response?.status;
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
      setUser((prev) => (prev === undefined ? null : prev));
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  // Handle app resume for Native Capacitor
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

  const exchangeSupabaseToken = useCallback(async ({ dob, handle } = {}) => {
    const access_token = await sbGetAccessToken();
    if (!access_token) throw new Error("No Supabase session");
    const { data } = await api.post("/auth/supabase-login", {
      access_token, dob, handle,
    });
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
  }, []);

  // FIX: Stable ref to prevent onSupabaseAuth from re-subscribing in an infinite loop
  const exchangeRef = useRef(exchangeSupabaseToken);
  useEffect(() => {
    exchangeRef.current = exchangeSupabaseToken;
  }, [exchangeSupabaseToken]);

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
    await sbSignInGoogle();
    return null;
  }, []);

  const requestSupabasePasswordReset = useCallback(async (email) => {
    return sbSendPasswordReset(email);
  }, []);

  // Hydrate Supabase session on mount & listen for auth changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sess = await sbGetSession();
        if (sess && !cancelled) {
          try { await exchangeRef.current(); } catch (e) { console.warn("sb initial exchange failed", e); }
        }
      } catch { /* no session */ }
    })();

    const unsub = onSupabaseAuth(async (session) => {
      if (!session) return;
      try { await exchangeRef.current(); } catch (e) { console.warn("sb auth-change exchange failed", e); }
    });

    return () => { cancelled = true; unsub(); };
  }, []); // Run once on mount

  // Google OAuth deep-link handler for Capacitor APK
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
          await supa.auth.exchangeCodeForSession(code);
        } else if (access && refresh) {
          await supa.auth.setSession({ access_token: access, refresh_token: refresh });
        } else {
          toast.error("Google returned no sign-in code. Please try again.");
          return;
        }
        await exchangeRef.current();
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
      } catch { /* plugin missing on web */ }
    })();

    return () => {
      cancelled = true;
      try { handleRef?.remove?.(); } catch { /* ignore */ }
    };
  }, []);

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
