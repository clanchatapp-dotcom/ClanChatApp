import { NavLink } from "react-router-dom";
import { Home, Search, MessageCircle, User, Bell } from "lucide-react";
import useNotifCounts from "../hooks/useNotifCounts";
import { useAuth } from "../context/AuthContext";

function Dot({ show }) {
  if (!show) return null;
  return (
    <span
      data-testid="nav-notif-dot"
      className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-[#FF5A00] ring-2 ring-black"
    />
  );
}

export default function BottomNav() {
  const { user } = useAuth();
  const { counts } = useNotifCounts(!!user);

  const items = [
    { to: "/feed", icon: Home, label: "Feed", testId: "nav-feed", dot: false },
    { to: "/search", icon: Search, label: "Search", testId: "nav-search", dot: false },
    { to: "/messages", icon: MessageCircle, label: "Messages", testId: "nav-messages", dot: counts.unread_dms > 0 },
    { to: "/notifications", icon: Bell, label: "Activity", testId: "nav-notifications",
      dot: (counts.follow_requests + counts.inner_invites + counts.new_followers + counts.tag_pending + counts.group_invites + counts.warnings) > 0 },
    { to: "/me", icon: User, label: "Profile", testId: "nav-profile", dot: false },
  ];

  return (
    <nav
      data-testid="bottom-nav"
      className="lg:hidden fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-black/80 dark:bg-black/80 backdrop-blur-xl border-t border-zinc-900 z-50"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex justify-around items-center pt-2 pb-2 px-2">
        {items.map(({ to, icon: Icon, label, testId, dot }) => (
          <NavLink
            key={to}
            to={to}
            data-testid={testId}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-1 px-2 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                isActive ? "text-[#FF5A00]" : "text-zinc-500 hover:text-zinc-300"
              }`
            }
          >
            <span className="relative">
              <Icon size={22} strokeWidth={1.6} />
              <Dot show={dot} />
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
