import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import api, { fileUrl, formatApiError } from "../lib/api";
import {
  ArrowLeft, Crown, Users, UserMinus, UserPlus, XCircle, Check,
  ShieldCheck, Clock, ChevronRight, UserRoundX,
} from "lucide-react";

/**
 * /connections — the "manage everyone" screen.
 *
 * Groups every relationship by tier so the owner can see the full picture
 * and demote/promote in one place:
 *   Tier 3 (Inner Circle) — invited + accepted
 *   Tier 2 (Followers)    — approved followers not in IC
 *   Pending IC invites    — sent but not accepted
 *   Follow requests       — waiting on my approval
 *   People I follow       — my tier IN their world
 *
 * Explicit promote/demote actions match what's actually possible:
 *   - IC member → "Demote to follower" (drop from IC, keep as follower)
 *   - IC member → "Remove entirely" (drop from IC + remove as follower)
 *   - Follower → "Invite to Inner Circle" (send invite, they must accept)
 *   - Follower → "Remove" (drop from followers)
 * Promotion from Tier 1 → Tier 2 is NOT one-click: the other user has to
 * follow me. That's a spec rule (approval flows only work one direction).
 */
export default function Connections() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/connections");
      setData(data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, []);

  const withBusy = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); await load(); }
    finally { setBusy(false); }
  };

  const demoteFromIC = (u) => withBusy(async () => {
    if (!window.confirm(`Demote #${u.handle} to Tier 2 (Follower)? They'll lose Inner Circle access but stay a follower.`)) return;
    try {
      await api.delete(`/inner/members/${u.user_id}`);
      toast.success(`#${u.handle} demoted to Follower`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  });

  const removeICEntirely = (u) => withBusy(async () => {
    if (!window.confirm(`Remove #${u.handle} entirely? They'll drop to Tier 1 (Public only).`)) return;
    try {
      await api.delete(`/inner/members/${u.user_id}`);
      await api.post(`/follow/remove/${u.user_id}`);
      toast.success(`#${u.handle} moved to Tier 1`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  });

  const inviteToIC = (u) => withBusy(async () => {
    try {
      await api.post("/inner/invite", {
        user_id: u.user_id,
        permissions: { dms: true, audio_messages: true, audio_calls: true, video_calls: true },
      });
      toast.success(`Invited #${u.handle} to Inner Circle — waiting on them to accept.`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  });

  const removeFollower = (u) => withBusy(async () => {
    if (!window.confirm(`Remove #${u.handle} from your followers?`)) return;
    try {
      await api.post(`/follow/remove/${u.user_id}`);
      toast.success(`#${u.handle} removed from followers`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  });

  const cancelInvite = (u) => withBusy(async () => {
    if (!window.confirm(`Cancel the Inner Circle invite to #${u.handle}?`)) return;
    // Demoting via the same delete endpoint drops the pending row too.
    try {
      await api.delete(`/inner/members/${u.user_id}`);
      toast.success("Invite cancelled");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  });

  const approveRequest = (u) => withBusy(async () => {
    try {
      await api.post(`/follow/requests/${u.follow_id}/approve`);
      toast.success(`Accepted #${u.handle}`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  });
  const declineRequest = (u) => withBusy(async () => {
    try {
      await api.post(`/follow/requests/${u.follow_id}/decline`);
      toast.success("Declined");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  });

  const unfollow = (u) => withBusy(async () => {
    if (!window.confirm(`Unfollow #${u.handle}?`)) return;
    try {
      await api.delete(`/follow/${u.user_id}`);
      toast.success(`Unfollowed #${u.handle}`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  });

  if (!data) return <div className="p-6 text-zinc-500 text-sm">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-24" data-testid="connections-page">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/settings" className="w-9 h-9 rounded-full border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200" data-testid="connections-back">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="font-heading text-xl">My connections</h1>
          <p className="text-[11px] text-zinc-500">Manage every tier in one place.</p>
        </div>
      </div>

      {/* Legend */}
      <div className="border border-zinc-900 rounded-2xl p-3 mb-4 text-[11px] text-zinc-500 leading-relaxed">
        <div className="flex items-center gap-2 mb-1"><Crown size={12} className="text-[#FF5A00]" /><strong className="text-zinc-300">Tier 3 · Inner Circle</strong> — sees everything, DMs open, can be added to group chats.</div>
        <div className="flex items-center gap-2 mb-1"><Users size={12} className="text-sky-400" /><strong className="text-zinc-300">Tier 2 · Followers</strong> — sees Tier 2 posts, DMs if you enabled the toggle.</div>
        <div className="flex items-center gap-2"><ShieldCheck size={12} className="text-zinc-400" /><strong className="text-zinc-300">Tier 1 · Public</strong> — sees only public posts. Everyone else.</div>
      </div>

      {/* Pending follow requests — top priority so I don't miss anyone */}
      {data.pending_follow_requests_in.length > 0 && (
        <Section
          title={`Waiting on your approval (${data.pending_follow_requests_in.length})`}
          icon={<Clock size={13} className="text-amber-300" />}
        >
          {data.pending_follow_requests_in.map((u) => (
            <Row key={u.user_id} user={u} testId={`follow-req-${u.handle}`}>
              <IconButton testId={`approve-${u.handle}`} onClick={() => approveRequest(u)} label="Approve"><Check size={13} /></IconButton>
              <IconButton testId={`decline-${u.handle}`} onClick={() => declineRequest(u)} label="Decline" danger><XCircle size={13} /></IconButton>
            </Row>
          ))}
        </Section>
      )}

      {/* Tier 3 — Inner Circle */}
      <Section
        title={`Tier 3 · Inner Circle (${data.counts.tier_3})`}
        icon={<Crown size={13} className="text-[#FF5A00]" />}
        empty="Nobody in your Inner Circle yet. Promote a follower below."
        isEmpty={data.tier_3.length === 0}
      >
        {data.tier_3.map((u) => (
          <Row key={u.user_id} user={u} testId={`ic-${u.handle}`}>
            <IconButton testId={`demote-ic-${u.handle}`} onClick={() => demoteFromIC(u)} label="Demote to Follower">
              <ChevronRight size={13} className="rotate-90" />
            </IconButton>
            <IconButton testId={`remove-ic-${u.handle}`} onClick={() => removeICEntirely(u)} label="Remove entirely" danger>
              <UserRoundX size={13} />
            </IconButton>
          </Row>
        ))}
      </Section>

      {/* Tier 2 — Followers (not in IC) */}
      <Section
        title={`Tier 2 · Followers (${data.counts.tier_2})`}
        icon={<Users size={13} className="text-sky-400" />}
        empty="No approved followers outside your Inner Circle."
        isEmpty={data.tier_2.length === 0}
      >
        {data.tier_2.map((u) => (
          <Row key={u.user_id} user={u} testId={`follower-${u.handle}`}>
            <IconButton testId={`promote-${u.handle}`} onClick={() => inviteToIC(u)} label="Invite to Inner Circle">
              <UserPlus size={13} className="text-[#FF5A00]" />
            </IconButton>
            <IconButton testId={`remove-follower-${u.handle}`} onClick={() => removeFollower(u)} label="Remove" danger>
              <UserMinus size={13} />
            </IconButton>
          </Row>
        ))}
      </Section>

      {/* Pending IC invites I sent */}
      {data.pending_invites_out.length > 0 && (
        <Section
          title={`IC invites you sent (${data.pending_invites_out.length})`}
          icon={<Clock size={13} className="text-zinc-400" />}
        >
          {data.pending_invites_out.map((u) => (
            <Row key={u.user_id} user={u} testId={`invite-out-${u.handle}`}>
              <span className="text-[11px] text-zinc-500 mr-2">Waiting…</span>
              <IconButton testId={`cancel-invite-${u.handle}`} onClick={() => cancelInvite(u)} label="Cancel" danger>
                <XCircle size={13} />
              </IconButton>
            </Row>
          ))}
        </Section>
      )}

      {/* People I follow — my tier IN their world */}
      <Section
        title={`I follow (${data.counts.following})`}
        icon={<Users size={13} className="text-zinc-400" />}
        empty="You're not following anyone yet."
        isEmpty={data.following.length === 0}
      >
        {data.following.map((u) => (
          <Row key={u.user_id} user={u} testId={`following-${u.handle}`}>
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-2 border border-zinc-800 px-1.5 py-0.5 rounded">
              I'm Tier {u.my_tier_with_them}
            </span>
            <IconButton testId={`unfollow-${u.handle}`} onClick={() => unfollow(u)} label="Unfollow" danger>
              <UserMinus size={13} />
            </IconButton>
          </Row>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, icon, children, empty, isEmpty }) {
  return (
    <section className="mb-6" data-testid={`section-${title.split(" ")[0].toLowerCase()}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-2">
        {icon}
        <span>{title}</span>
      </div>
      {isEmpty ? (
        <div className="text-zinc-600 text-sm text-center py-6 border border-zinc-900 rounded-2xl border-dashed">{empty}</div>
      ) : (
        <div className="flex flex-col gap-2">{children}</div>
      )}
    </section>
  );
}

function Row({ user, children, testId }) {
  return (
    <div
      className="border border-zinc-900 rounded-2xl p-2.5 flex items-center gap-3"
      data-testid={testId}
    >
      <Link to={`/u/${user.handle}`} className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-9 h-9 rounded-full bg-zinc-900 overflow-hidden shrink-0 flex items-center justify-center">
          {user.avatar_path ? (
            <img src={fileUrl(user.avatar_path)} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="font-heading text-sm text-zinc-500">{user.handle?.[0]?.toUpperCase()}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">#{user.handle}</div>
          {user.display_name && <div className="text-[11px] text-zinc-500 truncate">{user.display_name}</div>}
        </div>
      </Link>
      <div className="flex items-center gap-1.5 shrink-0">{children}</div>
    </div>
  );
}

function IconButton({ children, onClick, label, danger, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-8 h-8 rounded-full border flex items-center justify-center transition ${
        danger
          ? "border-red-500/40 text-red-300 hover:bg-red-500/10"
          : "border-zinc-800 text-zinc-300 hover:border-[#FF5A00] hover:text-[#FF5A00]"
      }`}
    >
      {children}
    </button>
  );
}
