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
  // Try Capacitor Preferences first on native. If the plugin bridge is still
  // warming up right after a WebView cold-start / OS resume, `Preferences.get`
  // resolves with `{value: null}` even though the token is in SharedPreferences.
  // In that case we MUST still fall through to localStorage — otherwise the
  // request goes out with no Bearer header, hits 401, and the AuthContext
  // logs the user out. That was the "kicked out after a few minutes of
  // inactivity" bug (iter 26).
  if (isNative()) {
    try {
      const { value } = await Preferences.get({ key: ACCESS_KEY });
      if (value) return value;
    } catch { /* fall through */ }
  }
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
  if (_tokenLoaded && _tokenCache) return;
  const val = await getToken();
  _tokenCache = val;
  // Only mark loaded when we actually got a token. If storage was empty
  // right now, allow the next request to try again — otherwise a single
  // racy read after a WebView resume permanently poisons the cache for
  // the rest of the session.
  _tokenLoaded = !!val;
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

/**
 * Upload a File/Blob to Supabase Storage via a backend-issued signed URL.
 *
 *   const { path, content_type } = await uploadFile(file, "post");
 *
 * `path` is the public Supabase Storage URL (starts with https://...).
 * `fileUrl(path)` returns it verbatim so all existing render code works.
 *
 * Scopes: "post" | "avatar" | "wall" | "dm" | "audio"
 */
export async function uploadFile(file, scope = "post") {
  if (!file) throw new Error("No file supplied");
  const filename = file.name || `blob_${Date.now()}`;
  const contentType = file.type || "application/octet-stream";
  // Ask the backend for a scoped, time-limited signed URL.
  const { data: signed } = await api.post("/upload/signed-url", {
    filename, content_type: contentType, scope,
  });
  // PUT the raw bytes straight to Supabase Storage. axios is intentionally
  // NOT used here — the signed URL is on supabase.co and the axios instance
  // is scoped to our own backend.
  const put = await fetch(signed.upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType, "x-upsert": "true" },
    body: file,
  });
  if (!put.ok) {
    const body = await put.text().catch(() => "");
    throw new Error(`Supabase upload failed (${put.status}): ${body.slice(0, 200)}`);
  }
  return {
    path: signed.public_url,      // stored verbatim on the post/message/etc.
    content_type: contentType,
    supabase_path: signed.path,   // internal path — useful for admin deletes
  };
}
