import { createClient } from "@supabase/supabase-js";
import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "";
const CONFIG_ENDPOINT = `${BACKEND}/api/supabase/config`;

let _clientPromise = null;

/**
 * Lazily load Supabase config from the backend (so we can rotate keys
 * without a frontend rebuild) and return an initialised client.
 * Idempotent: always returns the same promise.
 */
async function getSupabase() {
  if (_clientPromise) return _clientPromise;
  const p = (async () => {
    let cfg;
    try {
      cfg = (await axios.get(CONFIG_ENDPOINT)).data;
    } catch (e) {
      console.error("Failed to load Supabase config:", e);
      throw new Error(`Supabase config unavailable: ${e.message}`);
    }
    if (!cfg?.url || !cfg?.key) {
      throw new Error("Supabase config missing url or key");
    }
    const supabase = createClient(cfg.url, cfg.key);
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
        // FIX: Force PKCE code flow (S256) instead of implicit flow
        // This prevents Android from stripping the auth code from URL fragments
        codeChallengeMethod: 'S256',
      },
    });
    if (error) {
      console.error("OAuth URL generation failed:", error);
      throw new Error(`Google sign-in setup failed: ${error.message}`);
    }
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

  // Web: dynamic redirectTo by platform. index.js has already moved everyone
  // onto the single canonical host (www.clanchat.app in prod; the preview host
  // on preview), so window.location.origin IS the canonical origin here —
  // using it guarantees PKCE starts and finishes on the SAME origin (the
  // code-verifier is per-origin). We return to /feed; App.js exchanges the
  // ?code= at the root and the Protected guard waits during that exchange, so
  // landing on /feed does not bounce or loop.
  const { data, error } = await supa.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/feed`,
      // FIX: Explicit PKCE for web as well for consistency
      codeChallengeMethod: 'S256',
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
