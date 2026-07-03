import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { rememberToken, forgetToken } from "../lib/api";

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
    await forgetToken();
    try { localStorage.removeItem("cc_last_user"); } catch { /* ignore */ }
    setUser(null);
  };
  const refresh = async () => {
    const { data } = await api.get("/auth/me");
    setUser(data);
    return data;
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, register, logout, refresh, theme, setTheme }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
