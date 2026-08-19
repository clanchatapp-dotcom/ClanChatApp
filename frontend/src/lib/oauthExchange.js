/**
 * SINGLE owner of the Supabase PKCE `?code=` exchange.
 *
 * Why this file exists
 * --------------------
 * Previously BOTH `App.js` (useOAuthReturn) and `AuthContext` read
 * `?code=` on mount and called `supabase.auth.exchangeCodeForSession(code)`.
 * A PKCE code is SINGLE USE:
 *   - the first caller succeeds,
 *   - the second gets "invalid request: both auth code and code verifier
 *     should be non-empty" / "invalid grant",
 *   - App.js then treated that as a broken verifier and fired a BRAND NEW
 *     signInWithOAuth() redirect -> back to Google -> back to /feed -> repeat.
 * That is the "Google button sends me to the welcome screen / page keeps
 * flickering" bug.
 *
 * React 19 StrictMode makes it worse: effects run twice on mount, and a
 * `useRef` guard does NOT survive the StrictMode remount, so even a single
 * component exchanged twice.
 *
 * The guard below is MODULE level, so it survives StrictMode remounts and is
 * shared by every caller. Every caller awaits the SAME promise.
 */
import { getSupabase } from "./supabase";

let exchangePromise = null;

/** True if a PKCE code is currently in the URL (sync, cheap). */
export function hasOAuthCodeInUrl() {
  try {
    return new URLSearchParams(window.location.search).has("code");
  } catch {
    return false;
  }
}

function stripOAuthParamsFromUrl() {
  try {
    window.history.replaceState({}, "", window.location.pathname);
  } catch {
    /* ignore */
  }
}

/**
 * Exchange the `?code=` in the URL for a Supabase session, exactly once per
 * page load. Resolves to:
 *   { status: "none" }      – no code in the URL, nothing to do
 *   { status: "ok" }        – session established
 *   { status: "error", error, message }
 * Never throws, never re-triggers a new OAuth redirect.
 */
export function consumeOAuthCode() {
  if (exchangePromise) return exchangePromise;

  exchangePromise = (async () => {
    let params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return { status: "none" };
    }

    const providerError = params.get("error_description") || params.get("error");
    if (providerError) {
      stripOAuthParamsFromUrl();
      return { status: "error", message: `Google sign-in failed: ${providerError}` };
    }

    const code = params.get("code");
    if (!code) return { status: "none" };

    try {
      const supa = await getSupabase();
      const { error } = await supa.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return { status: "ok" };
    } catch (error) {
      return {
        status: "error",
        error,
        message:
          "Google sign-in didn't complete (the link expired or was opened in a different browser). Please tap Continue with Google again.",
      };
    } finally {
      // Single-use code: strip it so a refresh / back-nav can never replay it.
      stripOAuthParamsFromUrl();
    }
  })();

  return exchangePromise;
}

