import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import { toast } from "sonner";

export default function BoardView() {
  const { boardId } = useParams();
  const [data, setData] = useState(null);
  const [text, setText] = useState("");

  const load = () => api.get(`/boards/${boardId}/messages`).then(r => setData(r.data)).catch(e => toast.error(formatApiError(e.response?.data?.detail)));
  useEffect(() => { load(); }, [boardId, load]);

  const post = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api.post(`/boards/${boardId}/messages`, { content: text });
      setText(""); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  if (!data) return <div className="p-10 text-zinc-500 text-sm">Loading…</div>;

  return (
    <div className="px-5 pt-6 pb-32">
      <header className="flex items-center justify-between mb-5">
        <Link to={`/me`} className="text-zinc-500 text-sm">← Back</Link>
        <span className={`tier-pill-${data.board.tier} text-[10px] uppercase tracking-wider px-2 py-1 rounded`}>{data.board.tier}</span>
      </header>
      <h1 className="font-heading text-2xl mb-1">{data.board.title}</h1>
      {data.board.description && <p className="text-sm text-zinc-500 mb-5">{data.board.description}</p>}

      <div className="flex flex-col gap-3">
        {data.messages.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">Be first to start the discussion.</div>}
        {data.messages.map(m => (
          <div key={m.message_id} className="border border-zinc-900 rounded-2xl p-3">
            <div className="text-xs text-zinc-500 mb-1">#{m.author?.handle}</div>
            <div className="text-sm whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
      </div>

      {data.can_post && (
        <form onSubmit={post} className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-2">
          <div className="flex gap-2 bg-zinc-950 border border-zinc-900 rounded-full p-1.5">
            <input data-testid="board-msg-input" className="flex-1 bg-transparent px-3 py-1 outline-none text-sm"
              placeholder="Add to discussion…" value={text} onChange={e => setText(e.target.value)} />
            <button data-testid="board-msg-send" className="bg-[#FF5A00] text-black px-4 py-1.5 rounded-full text-xs uppercase tracking-wider">Post</button>
          </div>
        </form>
      )}
    </div>
  );
}
