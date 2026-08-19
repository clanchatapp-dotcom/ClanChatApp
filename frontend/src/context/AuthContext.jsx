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
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem("cc_last_user");
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  });

  const [bootstrapping, setBootstrapping] = useState(true);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("cc_theme") || "dark"
  );
  const [pendingProfile, setPendingProfile] = useState(null);

  useEffect(() => {
    try {
      if (user) {
        localStorage.setItem("cc_last_user", JSON.stringify(user));
      } else if (user === null) {
        localStorage.removeItem("cc_last_user");
      }
    } catch {
      // Ignore private-mode/localStorage errors.
    }
  }, [user]);

  const checkAuth = useCallback(async () => {
    if (window.location.hash?.includes("session_id=")) return;

    const attempt = () => api.get("/auth/me").then((r) => r.data);

    let data = null;
    let firstErr = null;

    try {
      data = await attempt();
    } catch (err) {
      firstErr = err;

      if (err?.response?.status === 401) {
        const persisted = await getToken();

        if (persisted) {
          await new Promise((resolve) => setTimeout(resolve, 400));

          try {
            data = await attempt();
            firstErr = null;
          } catch (err2) {
            firstErr = err2;
          }
        }
      }
    }

    if (data) {
      setUser(data);
      return data;
    }

    const status = firstErr?.response?.status;

    if (status === 401 || status === 403) {
      await forgetToken();
      setUser(null);
    } else {
      setUser((prev) => (prev === undefined ? null : prev));
    }

    return null;
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    if (theme === "light") {
      root.classList.add("light");
    } else {
      root.classList.remove("light");
    }

    localStorage.setItem("cc_theme", theme);
  }, [theme]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", {
      email,
      password,
    });

    if (data.access_token) {
      await rememberToken(data.access_token, data.refresh_token);
    }

    setUser(data.user);
    return data.user;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);

    if (data.access_token) {
      await rememberToken(data.access_token, data.refresh_token);
    }

    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    await forgetToken();

    try {
      localStorage.removeItem("cc_last_user");
    } catch {
      // Ignore.
    }

    setPendingProfile(null);
    setUser(null);

    api.post("/auth/logout").catch(() => {});

    Promise.resolve()
      .then(() => supabaseSignOut())
      .catch(() => {});
  };

  const refresh = async () => {
    const { data } = await api.get("/auth/me");
    setUser(data);
    return data;
  };

  // ------------------------------------------------------------
  // Supabase session -> ClanChat JWT exchange
  // ------------------------------------------------------------

  const inFlightExchange = useRef(null);

  const exchangeSupabaseToken = useCallback(
    async ({ dob, handle } = {}) => {
      const isProfileSubmit = Boolean(dob || handle);

      if (!isProfileSubmit && inFlightExchange.current) {
        return inFlightExchange
