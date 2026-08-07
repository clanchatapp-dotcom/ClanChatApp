import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import { Preferences } from "@capacitor/preferences";

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

// Key used to persist Supabase session on native platforms
const SB_SESSION_KEY = "cc_sb_session";

async function persistSbSession(session) {
  try {
    await Preferences.set({ key: SB_SESSION_KEY, value: JSON.stringify(session || null) });
  } catch { /* ignore */ }
}

async function restoreSbSession(supabase) {
  try {
    const { value } = await Preferences.get({ key: SB_SESSION_KEY });
    if (value) {
      const sess = JSON.parse(value);
      // setSession expects an object with access_token and refresh_token
      if (sess?.access_token || sess?.refresh_token) {
        // supabase client v2 exposes auth.setSession
        try { await supabase.auth.setSession({ access_token: sess.access_token, refresh_token: sess.refresh_token }); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
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
        detectSessionInUrl: true, // needed for OAuth redirect flow
        storageKey: "cc.sb.session",
      },
    });
    // Attach bucket name for convenience in uploaders.
    supabase._ccBucket = cfg.bucket;

    // Try to restore a persisted Supabase session (native only). This helps
    // when the WebView is cold-started / resumed — restoring the client
    // session lets exchangeSupabaseToken succeed without a round-trip.
    await restoreSbSession(supabase).catch(() => {});

    // Keep the persisted copy up-to-date when the client session changes.
    try {
      supabase.auth.onAuthStateChange((_evt, session) => {
        persistSbSession(session);
      });
    } catch { /* ignore */ }

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
  const { data, error } = await supa.auth.signInWithOAuth({
    provider: "google",
    options: {
      // Send the user straight back to /feed after Google finishes — the
      // AuthContext hydration effect will pick up the session on load.
      redirectTo: `${window.location.origin}/feed`,
    },
  });
  if (error) throw error;
  return data;
}

export async function sbSignOut() {
  try {
    const supa = await getSupabase();
    await supa.auth.signOut();
    // clear persisted native session on signout
    try { await Preferences.remove({ key: SB_SESSION_KEY }); } catch { /* ignore */ }
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

/** Subscribe to Supabase auth state changes. Returns unsubscribe fn. */
export function onSupabaseAuth(cb) {
  let subscription = null;
  getSupabase().then((supa) => {
    const { data } = supa.auth.onAuthStateChange((_evt, session) => cb(session));
    subscription = data.subscription;
  });
  return () => { try { subscription?.unsubscribe(); } catch { /* ignore */ } };
}
