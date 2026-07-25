import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

/**
 * Android hardware back button handler for the Capacitor APK.
 *
 * Behaviour (per user request — never kick the user out of the app):
 *   - Any screen except the home feed → navigate to `/feed`.
 *   - On the home feed → minimise the app (send to Android home screen).
 *     The app stays alive in the background exactly like every other
 *     well-behaved Android app.
 *   - The back button NEVER calls `App.exitApp()`. Only a swipe from
 *     recents can actually kill the process.
 *
 * The handler is a no-op on web / iOS.
 *
 * NOTE: `@capacitor/app` must be installed as a dependency AND synced
 * into the Android project (`npx cap sync android`) or `App.addListener`
 * won't be registered, and Capacitor's DEFAULT back-button behaviour
 * (exit-app) will fire instead. This bug bit us — the plugin was missing
 * from package.json until iter24.
 */
const HOME_PATHS = new Set(["/", "/feed", "/login"]);

export default function useAndroidBackButton() {
  const nav = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Guard: only run on native Android/iOS shells.
    if (!Capacitor?.isNativePlatform?.()) return;

    let handleRef;
    let cancelled = false;

    (async () => {
      try {
        handleRef = await App.addListener("backButton", () => {
          const path = location.pathname;
          if (!HOME_PATHS.has(path)) {
            // Anywhere off the feed → always land on the feed.
            nav("/feed", { replace: true });
            return;
          }
          // On the feed → minimise to Android home screen (background).
          // Never calls exitApp — that's the whole point of this fix.
          App.minimizeApp?.().catch(() => { /* older plugin versions may lack it */ });
        });
      } catch (e) {
        // Log but don't crash the app if the plugin isn't available.
        // eslint-disable-next-line no-console
        console.warn("useAndroidBackButton: App plugin unavailable", e);
      }
    })();

    return () => {
      cancelled = true;
      try { handleRef?.remove?.(); } catch { /* ignore */ }
      // `cancelled` is referenced so lint doesn't complain about the
      // dangling ref. Kept for future async cleanup if we add polling.
      void cancelled;
    };
  }, [location.pathname, nav]);
}
