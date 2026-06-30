import { useEffect, useState } from "react";
import api, { fileUrl, formatApiError } from "../lib/api";
import { Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

function timeAgo(iso) {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return d.toLocaleDateString();
}

export default function Comments({ post, currentUserId, onChange }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/posts/${post.post_id}/comments`);
      setData(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };
  useEffect(() => { load(); }, [post.post_id]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/posts/${post.post_id}/comments`, { content: text });
      setText("");
      await load();
      onChange?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const remove = async (cid) => {
    try {
      await api.delete(`/comments/${cid}`);
      await load();
      onChange?.();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  if (!data) {
    return <div className="text-zinc-600 text-xs py-3" data-testid="comments-loading">Loading…</div>;
  }

  return (
    <div className="mt-3 border-t border-zinc-900 pt-3 flex flex-col gap-3" data-testid={`comments-${post.post_id}`}>
      {data.comments.length === 0 && (
        <div className="text-xs text-zinc-600 text-center py-2">
          {data.can_comment ? "Be the first to comment." : "Only the Inner Circle can comment on this post."}
        </div>
      )}
      {data.comments.map(c => (
        <div key={c.comment_id} className="flex gap-2 text-sm" data-testid={`comment-${c.comment_id}`}>
          <div className="w-7 h-7 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center text-xs shrink-0">
            {c.author?.avatar_path ? (
              <img src={fileUrl(c.author.avatar_path)} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="font-heading">{(c.author?.handle?.[0] || "?").toUpperCase()}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-500">
              <Link to={`/u/${c.author?.handle}`} className="text-zinc-300 hover:text-[#FF5A00]">#{c.author?.handle}</Link>
              <span className="mx-1">·</span>{timeAgo(c.created_at)}
            </div>
            <div className="text-sm whitespace-pre-wrap break-words">{c.content}</div>
          </div>
          {(c.author?.user_id === currentUserId || post.author?.user_id === currentUserId) && (
            <button onClick={() => remove(c.comment_id)} data-testid={`del-comment-${c.comment_id}`}
              className="text-zinc-600 hover:text-red-400 p-1">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ))}

      {data.can_comment ? (
        <form onSubmit={send} className="flex gap-2 mt-1">
          <input
            data-testid={`comment-input-${post.post_id}`}
            className="flex-1 bg-zinc-950 border border-zinc-900 rounded-full px-3 py-1.5 text-sm outline-none focus:border-[#FF5A00]"
            placeholder="Add a comment…"
            value={text}
            onChange={e => setText(e.target.value)}
            maxLength={1000}
          />
          <button data-testid={`comment-send-${post.post_id}`}
            disabled={!text.trim() || busy}
            className="bg-[#FF5A00] disabled:bg-zinc-800 text-black px-3 rounded-full">
            <Send size={14} />
          </button>
        </form>
      ) : (
        <div className="text-[11px] text-zinc-600 italic text-center">Inner Circle only · Tier 3 comment lock</div>
      )}
    </div>
  );
}
