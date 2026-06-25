import { NavLink } from "react-router-dom";
import { Home, Search, MessageCircle, User } from "lucide-react";

const items = [
  { to: "/feed", icon: Home, label: "Feed", testId: "nav-feed" },
  { to: "/search", icon: Search, label: "Search", testId: "nav-search" },
  { to: "/messages", icon: MessageCircle, label: "Messages", testId: "nav-messages" },
  { to: "/me", icon: User, label: "Profile", testId: "nav-profile" },
];

export default function BottomNav() {
  return (
    <nav
      data-testid="bottom-nav"
      className="lg:hidden fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-black/80 dark:bg-black/80 backdrop-blur-xl border-t border-zinc-900 z-50"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex justify-around items-center pt-2 pb-2 px-4">
        {items.map(({ to, icon: Icon, label, testId }) => (
          <NavLink
            key={to}
            to={to}
            data-testid={testId}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-1 px-3 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                isActive ? "text-[#FF5A00]" : "text-zinc-500 hover:text-zinc-300"
              }`
            }
          >
            <Icon size={22} strokeWidth={1.6} />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
