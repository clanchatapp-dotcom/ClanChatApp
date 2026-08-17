/**
 * Supabase Web SDK bootstrap for ClanChat.
 *
 * Config comes from the backend (`GET /api/supabase/config`) so ops can
 * rotate keys without a frontend rebuild.
 *
 * Session persistence: Supabase's default is localStorage. It survives
 * Capacitor cold starts and iOS Safari, so no extra config needed.
 */
import { createClient } from "@supabase/supabase-js";
import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "";
const CONFIG_ENDPOINT = `${BACKEND}/api/supabase/config`;

let _clientPromise = null;

async function loadConfig() {
  const { data } = await axios.get(CONFIG_ENDPOINT);
  if (!data?.url || !data?.anonKey) {
    throw new Error("Supabase config unavailable — backend returned empty url/anonKey");
  }
  return data;
}

/** Lazy singleton Supabase browser client.
 *
 * If config load fails (e.g. old backend without /api/supabase/config),
 * the cached promise is CLEARED so subsequent calls can retry once the
 * backend catches up. This matters during the deployment window where
 * production may still be running the pre-Supabase backend.
 */
export async function getSupabase() {
  if (_clientPromise) return _clientPromise;
  const p = (async () => {
    const cfg = await loadConfig();
    const supabase = createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false, // we exchange the ?code= explicitly on /login
        // Force PKCE. The default (implicit) flow returns the session in the
        // URL *fragment* (#access_token=…), which Android strips when Chrome
        // Custom Tabs fires the `clanchat://` deep-link intent — so the APK
        // received an empty callback and silently bounced back to sign-up.
        // PKCE returns `?code=…` in the query string (preserved in the
        // intent URI); the deep-link handler then calls exchangeCodeForSession.
        // PKCE is also handled automatically on the web via detectSessionInUrl.
        flowType: "pkce",
        storageKey: "cc.sb.session",
      },
    });
    // Attach bucket name for convenience in uploaders.
    supabase._ccBucket = cfg.bucket;
    return supabase;
  })();
  // Clear the cached promise if it rejects — otherwise a transient 404
  // during a partial deploy would poison the whole session.
  p.catch(() => { _clientPromise = null; });
  _clientPromise = p;
  return _clientPromise;
}

// ------------------------------------------------------------------
// Auth helpers
// ------------------------------------------------------------------
export async function sbSignInEmail(email, password) {
  const supa = await getSupabase();
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function sbSignUpEmail(email, password) {
  const supa = await getSupabase();
  const { data, error } = await supa.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function sbSendPasswordReset(email) {
  const supa = await getSupabase();
  const { error } = await supa.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
}

export async function sbSignInGoogle() {
  const supa = await getSupabase();
  // Detect Capacitor native (Android/iOS APK) — the WebView origin is
  // `https://localhost` which Google can't redirect to. Instead we open
  // OAuth in Chrome Custom Tabs and redirect back via a custom URL
  // scheme (`clanchat://auth-callback`) that the OS routes to the app
  // through the Android intent filter. The AuthContext listens for the
  // deep-link and completes the session.
  let isNativeApp = false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    isNativeApp = Capacitor?.isNativePlatform?.() || false;
  } catch { /* web */ }

  if (isNativeApp) {
    const { data, error } = await supa.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "clanchat://auth-callback",
        skipBrowserRedirect: true, // give us the URL, we'll open Chrome Custom Tabs
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Supabase did not return an OAuth URL");
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: data.url, presentationStyle: "popover" });
    } catch (openErr) {
      // Fallback to plain window.open if @capacitor/browser is missing.
      window.open(data.url, "_system");
    }
    return data;
  }

  // Web: normal redirect flow. Return to the PUBLIC /login route on the
  // CANONICAL origin (https://www.clanchat.app in prod — the domain edge
  // 308-redirects the bare apex to www, so www is the host that actually
  // terminates with a 200), never a protected page. PKCE requires the same
  // origin start->finish; index.js has already moved apex/emergent.host
  // visitors to www.clanchat.app, so window.location.origin is canonical
  // here, but we compute it defensively anyway. AuthContext's mount effect
  // reads the ?code= and calls exchangeCodeForSession explicitly.
  const origin =
    (window.location.hostname === "clanchat.app" ||
     window.location.hostname.endsWith(".emergent.host"))
      ? "https://www.clanchat.app"
      : window.location.origin;
  const { data, error } = await supa.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/login`,
    },
  });
  if (error) throw error;
  return data;
}

export async function sbSignOut() {
  try {
    const supa = await getSupabase();
    await supa.auth.signOut();
  } catch { /* ignore */ }
}

export async function sbGetAccessToken() {
  const supa = await getSupabase();
  const { data } = await supa.auth.getSession();
  return data?.session?.access_token || null;
}

export async function sbGetSession() {
  const supa = await getSupabase();
  const { data } = await supa.auth.getSession();
  return data?.session || null;
}

/** Subscribe to Supabase auth state changes. Returns unsubscribe fn.
 * If Supabase isn't configured yet the client init rejects — swallow it
 * so we don't surface an unhandled promise rejection (which trips the
 * CRA dev error overlay). Auth still works via the legacy JWT flow. */
export function onSupabaseAuth(cb) {
  let subscription = null;
  getSupabase()
    .then((supa) => {
      const { data } = supa.auth.onAuthStateChange((_evt, session) => cb(session));
      subscription = data.subscription;
    })
    .catch(() => { /* Supabase not configured — legacy auth handles login */ });
  return () => { try { subscription?.unsubscribe(); } catch { /* ignore */ } };
}
