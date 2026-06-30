import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";
import DesktopSidebar from "./DesktopSidebar";
import TrendingRail from "./TrendingRail";
import OnboardingTour from "./OnboardingTour";
import IncomingCallRinger from "./IncomingCallRinger";
import { useAuth } from "../context/AuthContext";
import usePushNotifications from "../hooks/usePushNotifications";

export default function AppShell() {
  const { user } = useAuth();
  const loc = useLocation();
  usePushNotifications(user);
  const isAuthRoute = ["/login", "/register", "/", "/onboard-google"].includes(loc.pathname);
  const inCall = loc.pathname.startsWith("/call/");
  const hideNav = !user || isAuthRoute || inCall;
  const showRail = !hideNav && (loc.pathname === "/feed" || loc.pathname.startsWith("/t/") || loc.pathname.startsWith("/u/") || loc.pathname === "/me");
  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className={`mx-auto ${isAuthRoute || !user ? "" : "lg:flex lg:max-w-6xl 2xl:max-w-7xl"}`}>
        {!hideNav && <DesktopSidebar />}
        <main className={`cc-shell ${!hideNav ? "cc-shell-wide lg:flex-1 lg:max-w-2xl lg:border-l lg:border-r lg:border-zinc-900 lg:pb-8" : ""}`}>
          <Outlet />
        </main>
        {showRail && <TrendingRail />}
      </div>
      {!hideNav && <BottomNav />}
      {user && <OnboardingTour />}
      {user && !inCall && <IncomingCallRinger />}
    </div>
  );
}
