import { NavLink, Link } from "react-router-dom";
import { Home, Search, MessageCircle, User, Users, Bell, Settings as Cog, ShieldCheck, Plus } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import useNotifCounts from "../hooks/useNotifCounts";

export default function DesktopSidebar() {
  const { user } = useAuth();
  const { counts } = useNotifCounts(!!user);

  const activityCount = counts.follow_requests + counts.inner_invites + counts.new_followers + counts.tag_pending + counts.group_invites + counts.warnings;

  const NAV = [
    { to: "/feed", icon: Home, label: "Feed", testId: "side-feed", badge: 0 },
    { to: "/search", icon: Search, label: "Search", testId: "side-search", badge: 0 },
    { to: "/messages", icon: MessageCircle, label: "Messages", testId: "side-messages", badge: counts.unread_dms },
    { to: "/groups", icon: Users, label: "Groups", testId: "side-groups", badge: counts.group_invites },
    { to: "/notifications", icon: Bell, label: "Activity", testId: "side-notifications", badge: activityCount },
    { to: "/me", icon: User, label: "Profile", testId: "side-profile", badge: 0 },
    { to: "/settings", icon: Cog, label: "Settings", testId: "side-settings", badge: 0 },
  ];

  return (
    <aside
      data-testid="desktop-sidebar"
      className="hidden lg:flex flex-col w-60 shrink-0 border-r border-zinc-900 h-screen sticky top-0 px-5 py-7"
    >
      <Link to="/feed" className="block mb-8" data-testid="brand-link">
        <div className="text-[10px] uppercase tracking-[0.35em] text-zinc-500">ClanChat</div>
        <div className="font-heading text-2xl mt-1 leading-none">
          Your<span className="text-[#FF5A00]">.</span>Clubhouse
        </div>
      </Link>

      <nav className="flex flex-col gap-1 flex-1">
        {NAV.map(({ to, icon: Icon, label, testId, badge }) => (
          <NavLink
            key={to}
            to={to}
            data-testid={testId}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-2.5 rounded-full transition-colors ${
                isActive ? "bg-[#FF5A00]/10 text-[#FF5A00]" : "text-zinc-300 hover:bg-zinc-900"
              }`
            }
          >
            <Icon size={18} strokeWidth={1.6} />
            <span className="text-sm flex-1">{label}</span>
            {badge > 0 && (
              <span data-testid={`side-badge-${testId}`} className="text-[10px] px-1.5 min-w-[18px] h-[18px] inline-flex items-center justify-center rounded-full bg-[#FF5A00] text-black font-semibold">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </NavLink>
        ))}
        {user?.role === "admin" && (
          <NavLink
            to="/admin"
            data-testid="side-admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-full transition-colors ${
                isActive ? "bg-[#FF5A00]/10 text-[#FF5A00]" : "text-zinc-300 hover:bg-zinc-900"
              }`
            }
          >
            <ShieldCheck size={18} strokeWidth={1.6} />
            <span className="text-sm">Admin</span>
          </NavLink>
        )}
      </nav>

      <Link
        to="/compose"
        data-testid="side-compose"
        className="cc-btn-primary w-full text-center text-sm py-3 inline-flex items-center justify-center gap-2"
      >
        <Plus size={16} /> New post
      </Link>

      {user && (
        <Link
          to="/me"
          className="mt-4 flex items-center gap-3 p-2 rounded-2xl hover:bg-zinc-900 transition"
        >
          <div className="w-9 h-9 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
            <span className="font-heading text-sm text-zinc-400">{user.handle?.[0]?.toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">#{user.handle}</div>
            <div className="text-[11px] text-zinc-500 truncate">{user.display_name}</div>
          </div>
        </Link>
      )}
    </aside>
  );
}
