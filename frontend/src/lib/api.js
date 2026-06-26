import axios from "axios";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// ─── Token storage ────────────────────────────────────────────────────────
// On the Android APK the WebView serves the bundled build from
// https://localhost, which can't share cookies with the API host
// (clanchat.app). So we persist a JWT bearer token instead. On the web we
// also dual-write to localStorage so refreshing the tab doesn't bounce the
// user — cookies still work, the bearer is just a belt-and-braces fallback.
const ACCESS_KEY = "clanchat_access_token";
const isNative = () => { try { return Capacitor.isNativePlatform(); } catch { return false; } };

export async function getToken() {
  try {
    if (isNative()) {
      const { value } = await Preferences.get({ key: ACCESS_KEY });
      return value || null;
    }
  } catch { /* fall through to localStorage */ }
  try { return localStorage.getItem(ACCESS_KEY); } catch { return null; }
}

export async function setToken(token) {
  if (!token) return clearToken();
  try {
    if (isNative()) await Preferences.set({ key: ACCESS_KEY, value: token });
  } catch { /* ignore */ }
  try { localStorage.setItem(ACCESS_KEY, token); } catch { /* ignore */ }
}

export async function clearToken() {
  try { if (isNative()) await Preferences.remove({ key: ACCESS_KEY }); } catch { /* ignore */ }
  try { localStorage.removeItem(ACCESS_KEY); } catch { /* ignore */ }
}

// ─── Axios instance ───────────────────────────────────────────────────────
const api = axios.create({
  baseURL: API,
  withCredentials: true, // keep cookies working on the web build
});

// Cache the token in-memory after the first read so the request interceptor
// doesn't hit Capacitor Preferences on every single API call.
let _tokenCache = null;
let _tokenLoaded = false;
async function primeTokenCache() {
  if (_tokenLoaded) return;
  _tokenCache = await getToken();
  _tokenLoaded = true;
}
export async function rememberToken(token) {
  _tokenCache = token || null;
  _tokenLoaded = true;
  await setToken(token);
}
export async function forgetToken() {
  _tokenCache = null;
  _tokenLoaded = true;
  await clearToken();
}

api.interceptors.request.use(async (config) => {
  if (!_tokenLoaded) await primeTokenCache();
  if (_tokenCache) {
    config.headers = config.headers || {};
    if (!config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${_tokenCache}`;
    }
  }
  return config;
});

export default api;

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export function fileUrl(path) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${API}/files/${path}`;
}
