import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

/**
 * Android hardware back button handler for the Capacitor APK.
 *
 * Rules requested by the user:
 *   1. On the home feed (or the landing/login page) with no history →
 *      exit the app (default Android behaviour).
 *   2. Everywhere else → navigate back one step in the router history.
 *
 * The handler is a no-op on web / iOS.
 */
export default function useAndroidBackButton() {
  const nav = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const Cap = typeof window !== "undefined" ? window.Capacitor : null;
    if (!Cap?.isNativePlatform?.()) return;
    const CapApp = Cap?.Plugins?.App;
    if (!CapApp?.addListener) return;

    let listenerHandle;
    const HOME_PATHS = ["/", "/feed", "/login"];
    const isHome = () => HOME_PATHS.includes(location.pathname);

    const attach = async () => {
      listenerHandle = await CapApp.addListener("backButton", ({ canGoBack }) => {
        if (isHome() && !canGoBack) {
          // On the home page with no history — exit the app.
          CapApp.exitApp?.();
          return;
        }
        if (window.history.length > 1) {
          nav(-1);
        } else {
          // No history and not on home → send to /feed instead of exiting
          // (safer than force-quitting from an unexpected entry point).
          nav("/feed", { replace: true });
        }
      });
    };
    attach();
    return () => {
      try { listenerHandle?.remove?.(); } catch { /* ignore */ }
    };
    // Location.pathname re-registers the listener so `isHome()` reflects
    // the current route. Cheap on every navigation.
  }, [location.pathname, nav]);
}
