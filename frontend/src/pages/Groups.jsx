import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { formatApiError, fileUrl } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { Users, Plus, X, Send } from "lucide-react";
import { useParams } from "react-router-dom";

export function Groups() {
  const [groups, setGroups] = useState([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [members, setMembers] = useState([]); // [{user_id, handle}]
  const [handleInput, setHandleInput] = useState("");
  const [innerList, setInnerList] = useState([]);

  const load = () => api.get("/groups").then(r => setGroups(r.data.groups)).catch(() => {});
  useEffect(() => { load(); api.get("/inner/members").then(r => setInnerList(r.data.members.map(m => m.member))).catch(() => {}); }, []);

  const addMember = (u) => {
    if (members.find(m => m.user_id === u.user_id)) return;
    if (members.length >= 14) { toast.error("Max 15 members (including you)"); return; }
    setMembers([...members, u]);
  };

  const create = async () => {
    if (!name.trim()) return;
    try {
      await api.post("/groups", { name, member_ids: members.map(m => m.user_id) });
      setName(""); setMembers([]); setCreating(false); load();
      toast.success("Group created");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center justify-between mb-5">
        <h1 className="font-heading text-3xl">My Groups</h1>
        <Link to="/messages" className="text-zinc-500 text-sm">DMs</Link>
      </header>
      <p className="text-xs text-zinc-500 mb-5">Inner Circle only · max 15 · everyone must accept · silent decline.</p>

      {!creating ? (
        <button data-testid="new-group-btn" onClick={() => setCreating(true)} className="cc-btn-secondary w-full text-sm py-2 mb-4 inline-flex items-center justify-center gap-2">
          <Plus size={14} /> New group
        </button>
      ) : (
        <div className="border border-zinc-900 rounded-2xl p-3 mb-4 flex flex-col gap-2">
          <input data-testid="group-name" className="cc-input" placeholder="Group name" value={name} onChange={e => setName(e.target.value)} />
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-2">Members ({members.length}/14)</div>
          <div className="flex flex-wrap gap-2">
            {members.map(m => (
              <span key={m.user_id} className="tag-chip">
                #{m.handle}
                <button onClick={() => setMembers(members.filter(x => x.user_id !== m.user_id))} className="ml-1 text-zinc-500 hover:text-red-400"><X size={10} /></button>
              </span>
            ))}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-2">Pick from Inner Circle</div>
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
            {innerList.map(u => (
              <button key={u.user_id} data-testid={`pick-ic-${u.handle}`} onClick={() => addMember(u)} className="text-xs bg-zinc-900 hover:bg-zinc-800 px-2 py-1 rounded">
                #{u.handle}
              </button>
            ))}
            {innerList.length === 0 && <div className="text-xs text-zinc-600">No Inner Circle members yet.</div>}
          </div>
          <div className="flex gap-2 mt-2">
            <button data-testid="group-create" onClick={create} className="cc-btn-primary text-sm flex-1 py-2">Create</button>
            <button onClick={() => setCreating(false)} className="cc-btn-secondary text-sm flex-1 py-2">Cancel</button>
          </div>
        </div>
      )}

      {groups.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">No groups yet.</div>}
      <div className="flex flex-col gap-2">
        {groups.map(g => (
          <Link to={`/g/${g.group_id}`} key={g.group_id} data-testid={`group-${g.group_id}`} className="border border-zinc-900 rounded-2xl p-3 hover:border-zinc-700 transition flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center"><Users size={16} className="text-zinc-400" /></div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{g.name}</div>
              <div className="text-xs text-zinc-500">{g.member_count} member{g.member_count !== 1 ? "s" : ""} · {g.my_status === "pending" ? "Invite pending" : "Active"}</div>
            </div>
            {g.my_status === "pending" && (
              <PendingButtons groupId={g.group_id} reload={load} />
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

function PendingButtons({ groupId, reload }) {
  const act = async (action, e) => {
    e.preventDefault(); e.stopPropagation();
    try { await api.post(`/groups/${groupId}/${action}`); reload(); }
    catch (e2) { toast.error(formatApiError(e2.response?.data?.detail)); }
  };
  return (
    <div className="flex gap-1">
      <button data-testid={`group-accept-${groupId}`} onClick={(e) => act("accept", e)} className="cc-btn-primary text-xs py-1 px-2">Accept</button>
      <button data-testid={`group-decline-${groupId}`} onClick={(e) => act("decline", e)} className="cc-btn-secondary text-xs py-1 px-2">Decline</button>
    </div>
  );
}

export function GroupChat() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [text, setText] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get(`/groups/${groupId}/messages`);
      setData(data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); nav("/groups"); }
  };
  useEffect(() => { load(); }, [groupId, nav]);
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api.post(`/groups/${groupId}/messages`, { content: text });
      setText(""); load();
    } catch (e2) { toast.error(formatApiError(e2.response?.data?.detail)); }
  };

  const leave = async () => {
    if (!window.confirm("Leave silently? Nobody will be notified.")) return;
    try { await api.post(`/groups/${groupId}/leave`); nav("/groups"); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  if (!data) return <div className="p-10 text-zinc-500 text-sm">Loading…</div>;

  return (
    <div className="px-5 pt-6 pb-32 flex flex-col min-h-screen">
      <header className="flex items-center justify-between mb-5">
        <button onClick={() => nav("/groups")} className="text-zinc-500 text-sm">← Groups</button>
        <button onClick={leave} data-testid="group-leave" className="text-zinc-500 text-xs hover:text-red-400">Leave silently</button>
      </header>
      <h1 className="font-heading text-2xl">{data.group.name}</h1>
      <p className="text-xs text-zinc-500 mb-5">{data.group.member_count} members · Inner Circle group</p>

      <div className="flex-1 flex flex-col gap-3">
        {data.messages.length === 0 && <div className="text-zinc-600 text-sm text-center py-10">Start the conversation.</div>}
        {data.messages.map(m => (
          <div key={m.message_id} className={`max-w-[80%] rounded-2xl px-4 py-2 ${m.from_id === user?.user_id ? "bg-[#FF5A00] text-black self-end" : "bg-zinc-900 self-start"}`}>
            <div className="text-sm whitespace-pre-wrap break-words">{m.content}</div>
          </div>
        ))}
      </div>

      <form onSubmit={send} className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-2">
        <div className="flex gap-2 bg-zinc-950 border border-zinc-900 rounded-full p-1.5">
          <input data-testid="group-input" className="flex-1 bg-transparent px-3 py-1 outline-none text-sm"
            placeholder="Message…" value={text} onChange={e => setText(e.target.value)} />
          <button data-testid="group-send" className="bg-[#FF5A00] text-black p-2 rounded-full" disabled={!text.trim()}>
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
