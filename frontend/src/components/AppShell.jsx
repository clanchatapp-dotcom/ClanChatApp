import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";
import { useAuth } from "../context/AuthContext";

export default function AppShell() {
  const { user } = useAuth();
  const loc = useLocation();
  const hideNav = !user || ["/login", "/register", "/", "/onboard-google"].includes(loc.pathname);
  return (
    <div className="cc-shell bg-background text-foreground">
      <Outlet />
      {!hideNav && <BottomNav />}
    </div>
  );
}
