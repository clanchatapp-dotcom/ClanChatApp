import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { fileUrl, formatApiError } from "../lib/api";
import { toast } from "sonner";

export default function InnerCircle() {
  const [members, setMembers] = useState([]);
  const [handle, setHandle] = useState("");
  const [perms, setPerms] = useState({ dms: true, audio_messages: false, audio_calls: false, video_calls: false });

  const load = () => api.get("/inner/members").then(r => setMembers(r.data.members)).catch(() => {});
  useEffect(() => { load(); }, []);

  const invite = async () => {
    if (!handle.trim()) return;
    try {
      const { data } = await api.get(`/users/by-handle/${handle.replace(/^#/, "")}`);
      await api.post("/inner/invite", { user_id: data.user.user_id, permissions: perms });
      toast.success("Invite sent");
      setHandle("");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-3xl">My Inner Circle</h1>
        <Link to="/settings" className="text-zinc-500 text-sm">Back</Link>
      </header>

      <div className="border border-zinc-900 rounded-2xl p-4 mb-6">
        <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-3">Invite by # handle</div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">#</span>
            <input data-testid="invite-handle" className="cc-input pl-7" placeholder="handle"
              value={handle} onChange={e => setHandle(e.target.value.toLowerCase())} />
          </div>
          <button data-testid="invite-btn" onClick={invite} className="cc-btn-primary text-sm">Invite</button>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
          {[
            ["dms", "DMs"],
            ["audio_messages", "Audio messages"],
            ["audio_calls", "Audio calls"],
            ["video_calls", "Video calls"],
          ].map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 p-2 border border-zinc-900 rounded-xl">
              <input data-testid={`perm-${k}`} type="checkbox" checked={perms[k]}
                onChange={e => setPerms({ ...perms, [k]: e.target.checked })} className="accent-[#FF5A00]" />
              <span className="text-xs">{l}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-3">Members ({members.length})</div>
      {members.length === 0 && <div className="text-zinc-600 text-sm text-center py-6">Your circle is empty.</div>}
      <div className="flex flex-col gap-2">
        {members.map(m => (
          <div key={m.member.user_id} className="flex items-center gap-3 p-3 border border-zinc-900 rounded-2xl">
            <div className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center">
              {m.member.avatar_path ? <img src={fileUrl(m.member.avatar_path)} className="w-full h-full object-cover" alt="" /> :
                <span className="font-heading text-zinc-400">{m.member.handle[0].toUpperCase()}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">#{m.member.handle}</div>
              <div className="text-xs text-zinc-500 truncate">
                {Object.entries(m.permissions).filter(([_, v]) => v).map(([k]) => k.replace("_", " ")).join(" · ") || "no permissions"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
