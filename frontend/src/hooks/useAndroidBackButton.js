import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";

/**
 * Android hardware back button handler for the Capacitor APK.
 *
 * Rules (per user request — never accidentally kill the app):
 *   1. Anywhere OFF the home feed → navigate to /feed (replace).
 *   2. On the home feed → require a second back-press within 2s to exit.
 *      Anything shorter surfaces a subtle toast so users can back-out
 *      of the app deliberately without a modal.
 *
 * The handler is a no-op on web / iOS.
 */
const HOME_PATHS = ["/", "/feed", "/login"];

export default function useAndroidBackButton() {
  const nav = useNavigate();
  const location = useLocation();
  // Persist the "arm exit" timestamp across re-registrations of the
  // listener (the effect re-runs on every route change).
  const lastPressRef = useRef(0);

  useEffect(() => {
    const Cap = typeof window !== "undefined" ? window.Capacitor : null;
    if (!Cap?.isNativePlatform?.()) return;
    const CapApp = Cap?.Plugins?.App;
    if (!CapApp?.addListener) return;

    let listenerHandle;
    const isHome = () => HOME_PATHS.includes(location.pathname);

    const attach = async () => {
      listenerHandle = await CapApp.addListener("backButton", () => {
        if (!isHome()) {
          // Always land on the feed — cheaper than trying to unwind an
          // unknown history stack and guarantees no accidental exit.
          nav("/feed", { replace: true });
          return;
        }
        // Home feed → double-tap-to-exit within 2 seconds.
        const now = Date.now();
        if (now - lastPressRef.current < 2000) {
          CapApp.exitApp?.();
          return;
        }
        lastPressRef.current = now;
        try {
          // Lightweight in-app toast; falls back silently if sonner
          // isn't mounted for some reason.
          import("sonner").then(({ toast }) => {
            toast("Press back again to exit ClanChat", { duration: 1800 });
          });
        } catch { /* ignore */ }
      });
    };
    attach();
    return () => {
      try { listenerHandle?.remove?.(); } catch { /* ignore */ }
    };
  }, [location.pathname, nav]);
}
