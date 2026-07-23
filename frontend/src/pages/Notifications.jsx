import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Heart, MessageCircle, UserPlus, Users, Sparkles, Tag, Bell, ShieldAlert, Check } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError, fileUrl } from "../lib/api";

/**
 * Chronological Activity Feed.
 *
 * Renders a single timeline of every "someone did something for you"
 * event from the backend's `activity_events` collection. Each row is
 * tappable — the tap:
 *   1. Immediately marks the event as read (optimistic UI update).
 *   2. Navigates to the relevant content (post/profile/group).
 *
 * The old sectioned page (Follow requests / Inner invites / Warnings /
 * Unread threads) is preserved BELOW the timeline for items that still
 * need an explicit approve/decline decision.
 */

const KIND_META = {
  post_liked:      { icon: Heart,       label: "liked your post",           color: "text-red-400" },
  post_commented:  { icon: MessageCircle, label: "commented on your post",  color: "text-blue-300" },
  post_tagged:     { icon: Tag,         label: "tagged you",                color: "text-purple-300" },
  follow_request:  { icon: UserPlus,    label: "requested to follow you",   color: "text-[#FF5A00]" },
  follow_accepted: { icon: UserPlus,    label: "is now following you",      color: "text-emerald-300" },
  inner_invite:    { icon: Sparkles,    label: "invited you to their Inner Circle", color: "text-purple-300" },
  group_invite:    { icon: Users,       label: "invited you to a group",    color: "text-[#FF5A00]" },
  group_message:   { icon: Users,       label: "sent a message in a group", color: "text-[#FF5A00]" },
  tag_pending:     { icon: Tag,         label: "tagged you (approval needed)", color: "text-amber-300" },
  dm_received:     { icon: MessageCircle, label: "sent you a message",      color: "text-blue-300" },
  warning:         { icon: ShieldAlert, label: "moderation warning",        color: "text-amber-400" },
};

function Avatar({ u, size = 36 }) {
  return u?.avatar_path ? (
    <img src={fileUrl(u.avatar_path)} alt="" className="rounded-full object-cover shrink-0"
         style={{ width: size, height: size }} />
  ) : (
    <span className="rounded-full bg-zinc-800 grid place-items-center text-xs shrink-0"
          style={{ width: size, height: size }}>
      {(u?.handle?.[0] || "?").toUpperCase()}
    </span>
  );
}

function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.floor((now - then) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

export default function Notifications() {
  const nav = useNavigate();
  const [events, setEvents] = useState([]);
  const [followRequests, setFollowRequests] = useState([]);
  const [innerInvites, setInnerInvites] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [ev, fr, ii, w] = await Promise.all([
        api.get("/activity/feed?limit=100"),
        api.get("/follow/requests"),
        api.get("/inner/invites"),
        api.get("/me/warnings"),
      ]);
      setEvents(ev.data.events || []);
      setFollowRequests(fr.data.requests);
      setInnerInvites(ii.data.invites);
      setWarnings(w.data.warnings);
    } catch (e) {
      console.warn("activity load failed", e);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    // Refresh on focus so backgrounded state doesn't go stale.
    const onFocus = () => load();
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const markAllRead = async () => {
    // Optimistic: paint everything read locally first, then confirm.
    setEvents((ev) => ev.map((e) => ({ ...e, read: true })));
    try {
      await api.post("/activity/read-all");
      // Also legacy mark-seen so bell dot clears.
      await api.post("/notifications/mark-seen").catch(() => {});
      window.dispatchEvent(new Event("clanchat:notif-refresh"));
      toast.success("All caught up");
    } catch (e) {
      console.warn("mark-all-read failed", e);
    }
  };

  const openEvent = async (e) => {
    // 1. Mark this specific event read optimistically + on server.
    setEvents((ev) => ev.map((x) => x.event_id === e.event_id ? { ...x, read: true } : x));
    api.post(`/activity/${e.event_id}/read`).catch(() => {});
    window.dispatchEvent(new Event("clanchat:notif-refresh"));
    // 2. Route to the referenced content.
    const ref = e.ref || {};
    const actor = e.actor;
    switch (e.kind) {
      case "post_liked":
      case "post_commented":
      case "post_tagged":
        // No standalone post-detail page yet — send to the user's own
        // profile Feed tab, that's where their liked/commented post lives.
        nav("/me");
        break;
      case "follow_request":
        // Stay on Activity — the pending-actions row above lets the user
        // approve/decline right here.
        break;
      case "follow_accepted":
        if (actor?.handle) nav(`/u/${actor.handle}`);
        break;
      case "inner_invite":
        // Stay on Activity — invite section handles accept/decline.
        break;
      case "group_invite":
      case "group_message":
        if (ref.group_id) nav(`/g/${ref.group_id}`);
        break;
      case "dm_received":
        if (actor?.user_id) nav(`/m/${actor.user_id}`);
        break;
      default:
        break;
    }
  };

  const actFollow = async (id, approve) => {
    try {
      await api.post(`/follow/requests/${id}/${approve ? "approve" : "decline"}`);
      setFollowRequests((rs) => rs.filter((r) => r.follow_id !== id));
      window.dispatchEvent(new Event("clanchat:notif-refresh"));
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const actInner = async (id, accept) => {
    try {
      await api.post(`/inner/invites/${id}/${accept ? "accept" : "decline"}`);
      setInnerInvites((is) => is.filter((i) => i.invite_id !== id));
      window.dispatchEvent(new Event("clanchat:notif-refresh"));
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const dismissWarn = async (id) => {
    try {
      await api.post(`/me/warnings/${id}/dismiss`);
      setWarnings((ws) => ws.filter((w) => w.warning_id !== id));
    } catch (e) { console.warn("dismiss warning failed", e); }
  };

  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center justify-between mb-5">
        <h1 className="font-heading text-3xl">Activity</h1>
        <button
          data-testid="mark-all-read-btn"
          onClick={markAllRead}
          className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-[#FF5A00] transition"
        >
          Mark all read
        </button>
      </header>

      {/* Pending decisions — approvals/invites always float to the top */}
      {(followRequests.length > 0 || innerInvites.length > 0 || warnings.length > 0) && (
        <section className="mb-6" data-testid="pending-actions">
          {followRequests.map(r => (
            <div key={r.follow_id} className="flex items-center gap-3 p-3 border border-zinc-900 rounded-2xl mb-2">
              <Avatar u={r.user} />
              <div className="flex-1 text-sm min-w-0">
                <Link to={`/u/${r.user.handle}`} className="font-medium truncate block">#{r.user.handle}</Link>
                <div className="text-xs text-zinc-500 truncate">wants to follow you</div>
              </div>
              <button data-testid={`approve-follow-${r.user.handle}`} onClick={() => actFollow(r.follow_id, true)} className="cc-btn-primary text-xs py-1.5 px-3">Approve</button>
              <button onClick={() => actFollow(r.follow_id, false)} className="cc-btn-secondary text-xs py-1.5 px-3">Decline</button>
            </div>
          ))}
          {innerInvites.map(i => (
            <div key={i.invite_id} className="flex items-center gap-3 p-3 border border-purple-500/30 bg-purple-500/5 rounded-2xl mb-2">
              <Avatar u={i.from} />
              <div className="flex-1 text-sm min-w-0">
                <div className="font-medium truncate">#{i.from.handle}</div>
                <div className="text-xs text-purple-200 truncate">Inner Circle invite</div>
              </div>
              <button data-testid={`accept-invite-${i.invite_id}`} onClick={() => actInner(i.invite_id, true)} className="cc-btn-primary text-xs py-1.5 px-3">Accept</button>
              <button onClick={() => actInner(i.invite_id, false)} className="cc-btn-secondary text-xs py-1.5 px-3">Decline</button>
            </div>
          ))}
          {warnings.map(w => (
            <div key={w.warning_id} className="flex items-start gap-3 p-3 border border-amber-500/30 bg-amber-500/5 rounded-2xl mb-2">
              <ShieldAlert size={18} className="text-amber-300 shrink-0 mt-0.5" />
              <div className="flex-1 text-sm min-w-0">
                <div className="text-amber-100 font-medium">{w.title || "Moderation warning"}</div>
                <div className="text-xs text-amber-200/70 mt-1 break-words">{w.body}</div>
              </div>
              <button onClick={() => dismissWarn(w.warning_id)} className="text-xs text-amber-200 shrink-0 hover:text-red-400">Dismiss</button>
            </div>
          ))}
        </section>
      )}

      {/* Chronological event stream */}
      <section data-testid="activity-timeline">
        {loading && <div className="text-zinc-600 text-sm">Loading…</div>}
        {!loading && events.length === 0 && followRequests.length === 0 && innerInvites.length === 0 && warnings.length === 0 && (
          <div className="text-zinc-600 text-sm text-center py-10">You&apos;re all caught up.</div>
        )}
        {events.map(e => {
          const meta = KIND_META[e.kind] || { icon: Bell, label: e.kind, color: "text-zinc-400" };
          const Icon = meta.icon;
          return (
            <button
              key={e.event_id}
              onClick={() => openEvent(e)}
              data-testid={`activity-${e.event_id}`}
              className={`w-full text-left flex items-center gap-3 p-3 border rounded-2xl mb-2 transition ${
                e.read
                  ? "border-zinc-900 hover:border-zinc-700"
                  : "border-[#FF5A00]/30 bg-[#FF5A00]/5 hover:border-[#FF5A00]/60"
              }`}
            >
              <div className="relative shrink-0">
                <Avatar u={e.actor} />
                <span className={`absolute -bottom-0.5 -right-0.5 rounded-full p-1 bg-zinc-950 border border-zinc-900 ${meta.color}`}>
                  <Icon size={11} strokeWidth={2.2} />
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">
                  <span className="font-medium">#{e.actor?.handle || "someone"}</span>{" "}
                  <span className="text-zinc-400">{meta.label}</span>
                </div>
                {e.post_preview?.content && (
                  <div className="text-xs text-zinc-500 truncate mt-0.5">
                    “{e.post_preview.content}”
                  </div>
                )}
              </div>
              <div className="text-[10px] text-zinc-600 shrink-0 self-start pt-1">{timeAgo(e.created_at)}</div>
              {!e.read && (
                <span className="w-2 h-2 rounded-full bg-[#FF5A00] shrink-0" data-testid="activity-unread-dot" />
              )}
            </button>
          );
        })}
      </section>
    </div>
  );
}
