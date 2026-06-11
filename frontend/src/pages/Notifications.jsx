import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { fileUrl, formatApiError } from "../lib/api";
import { toast } from "sonner";

export default function Notifications() {
  const [followRequests, setFollowRequests] = useState([]);
  const [innerInvites, setInnerInvites] = useState([]);

  const load = async () => {
    try {
      const [fr, ii] = await Promise.all([
        api.get("/follow/requests"),
        api.get("/inner/invites"),
      ]);
      setFollowRequests(fr.data.requests);
      setInnerInvites(ii.data.invites);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const actFollow = async (id, approve) => {
    try {
      await api.post(`/follow/requests/${id}/${approve ? "approve" : "decline"}`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const actInner = async (id, accept) => {
    try {
      await api.post(`/inner/invites/${id}/${accept ? "accept" : "decline"}`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center justify-between mb-5">
        <h1 className="font-heading text-3xl">Activity</h1>
        <Link to="/feed" className="text-zinc-500 text-sm">Back</Link>
      </header>

      <section className="mb-6">
        <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-3">Follow requests</div>
        {followRequests.length === 0 && <div className="text-zinc-600 text-sm">All caught up.</div>}
        {followRequests.map(r => (
          <div key={r.follow_id} className="flex items-center gap-3 p-3 border border-zinc-900 rounded-2xl mb-2">
            <Avatar u={r.user} />
            <div className="flex-1 text-sm">
              <Link to={`/u/${r.user.handle}`} className="font-medium">#{r.user.handle}</Link>
              <div className="text-xs text-zinc-500">{r.user.display_name}</div>
            </div>
            <button data-testid={`approve-follow-${r.user.handle}`} onClick={() => actFollow(r.follow_id, true)} className="cc-btn-primary text-xs py-1.5 px-3">Approve</button>
            <button onClick={() => actFollow(r.follow_id, false)} className="cc-btn-secondary text-xs py-1.5 px-3">Decline</button>
          </div>
        ))}
      </section>

      <section>
        <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-3">Inner Circle invites</div>
        {innerInvites.length === 0 && <div className="text-zinc-600 text-sm">No invites.</div>}
        {innerInvites.map(i => (
          <div key={i.invite_id} className="flex items-center gap-3 p-3 border border-zinc-900 rounded-2xl mb-2">
            <Avatar u={i.owner} />
            <div className="flex-1 text-sm">
              <Link to={`/u/${i.owner.handle}`} className="font-medium">#{i.owner.handle}</Link>
              <div className="text-xs text-zinc-500">Invited you to their Inner Circle</div>
            </div>
            <button data-testid={`accept-inner-${i.owner.handle}`} onClick={() => actInner(i.invite_id, true)} className="cc-btn-primary text-xs py-1.5 px-3">Accept</button>
            <button onClick={() => actInner(i.invite_id, false)} className="cc-btn-secondary text-xs py-1.5 px-3">Decline</button>
          </div>
        ))}
      </section>
    </div>
  );
}

function Avatar({ u }) {
  return (
    <div className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center">
      {u.avatar_path ? <img src={fileUrl(u.avatar_path)} className="w-full h-full object-cover" alt="" /> :
        <span className="font-heading text-zinc-400">{u.handle[0].toUpperCase()}</span>}
    </div>
  );
}
