import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import api, { fileUrl, formatApiError } from "../lib/api";
import { Send } from "lucide-react";
import { toast } from "sonner";

export function Messages() {
  const [threads, setThreads] = useState([]);
  useEffect(() => {
    api.get("/dms/threads").then(r => setThreads(r.data.threads)).catch(() => {});
  }, []);
  return (
    <div className="px-5 pt-6">
      <h1 className="font-heading text-3xl mb-5">Messages</h1>
      {threads.length === 0 && <div className="text-zinc-600 text-sm text-center py-10">No conversations yet.</div>}
      <div className="flex flex-col gap-1">
        {threads.map(t => (
          <Link to={`/m/${t.with.user_id}`} key={t.with.user_id} data-testid={`thread-${t.with.handle}`}
            className="flex items-center gap-3 p-3 rounded-2xl hover:bg-zinc-950 transition">
            <div className="w-12 h-12 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center">
              {t.with.avatar_path ? <img src={fileUrl(t.with.avatar_path)} alt="" className="w-full h-full object-cover" /> :
                <span className="font-heading text-zinc-400">{t.with.handle[0].toUpperCase()}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">#{t.with.handle}</div>
              <div className="text-xs text-zinc-500 truncate">{t.last.content}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function MessageThread() {
  const { userId } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/dms/with/${userId}`);
      setData(data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, [userId]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.post("/dms", { recipient_id: userId, content: text });
      setText("");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  if (!data) return <div className="p-10 text-zinc-500 text-sm">Loading…</div>;

  return (
    <div className="px-5 pt-6 pb-32 flex flex-col min-h-screen">
      <header className="flex items-center gap-3 mb-5">
        <button onClick={() => nav(-1)} className="text-zinc-500 text-sm">← Back</button>
        <Link to={`/u/${data.with?.handle}`} className="font-heading text-2xl">#{data.with?.handle}</Link>
      </header>

      <div className="flex-1 flex flex-col gap-3">
        {data.messages.map(m => (
          <div key={m.message_id} data-testid={`msg-${m.message_id}`}
            className={`max-w-[80%] rounded-2xl px-4 py-2 ${m.from_id === userId ? "bg-zinc-900 self-start" : "bg-[#FF5A00] text-black self-end"}`}>
            <div className="text-sm whitespace-pre-wrap break-words">{m.content}</div>
          </div>
        ))}
        {data.messages.length === 0 && <div className="text-zinc-600 text-sm text-center py-10">Say hi.</div>}
      </div>

      <form onSubmit={send} className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-2">
        {!data.can_send && (
          <div className="text-xs text-zinc-500 mb-2 text-center">{data.reason || "Cannot message this user"}</div>
        )}
        <div className="flex gap-2 bg-zinc-950 border border-zinc-900 rounded-full p-1.5">
          <input data-testid="dm-input"
            className="flex-1 bg-transparent px-3 py-1 outline-none text-sm"
            placeholder={data.can_send ? "Message…" : "DM not allowed"}
            value={text} onChange={e => setText(e.target.value)} disabled={!data.can_send} />
          <button data-testid="dm-send" className="bg-[#FF5A00] disabled:bg-zinc-800 text-black p-2 rounded-full"
            disabled={!data.can_send || !text.trim()}>
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
