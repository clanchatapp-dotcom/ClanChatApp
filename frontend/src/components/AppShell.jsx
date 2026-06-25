import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";
import DesktopSidebar from "./DesktopSidebar";
import OnboardingTour from "./OnboardingTour";
import { useAuth } from "../context/AuthContext";

export default function AppShell() {
  const { user } = useAuth();
  const loc = useLocation();
  const isAuthRoute = ["/login", "/register", "/", "/onboard-google"].includes(loc.pathname);
  const hideNav = !user || isAuthRoute;
  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className={`mx-auto ${isAuthRoute || !user ? "" : "lg:flex lg:max-w-6xl"}`}>
        {!hideNav && <DesktopSidebar />}
        <main className={`cc-shell ${!hideNav ? "cc-shell-wide lg:flex-1 lg:max-w-2xl lg:border-l lg:border-r lg:border-zinc-900 lg:pb-8" : ""}`}>
          <Outlet />
        </main>
      </div>
      {!hideNav && <BottomNav />}
      {user && <OnboardingTour />}
    </div>
  );
}
