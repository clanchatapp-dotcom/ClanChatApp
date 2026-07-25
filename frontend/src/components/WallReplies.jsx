import { useEffect, useState } from "react";
import api, { fileUrl, formatApiError } from "../lib/api";
import { CornerDownRight, Send, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import ReactionsBar from "./ReactionsBar";

function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Threaded replies under a wall note.
 *
 * Renders inline below its parent wall note. Fetches lazily when the
 * user taps "Reply" for the first time to avoid a burst of API calls
 * when the wall has many notes.
 *
 * Props:
 *   wallPostId  — parent note id
 *   ownerId     — user_id whose wall this is (needed for delete permission check)
 *   currentUserId — viewer, for showing/hiding the delete affordance
 */
export default function WallReplies({ wallPostId, ownerId, currentUserId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null); // { replies: [], can_reply: bool }
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data: fresh } = await api.get(`/wall/${wallPostId}/replies`);
      setData(fresh);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not load replies");
    }
  };

  useEffect(() => {
    if (open && !data) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const send = async (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await api.post(`/wall/${wallPostId}/replies`, { content: value });
      setText("");
      await load();
    } catch (e2) {
      toast.error(formatApiError(e2.response?.data?.detail) || "Could not reply");
    } finally { setBusy(false); }
  };

  const remove = async (rid) => {
    try {
      await api.delete(`/wall/replies/${rid}`);
      await load();
    } catch (e2) {
      toast.error(formatApiError(e2.response?.data?.detail) || "Could not delete");
    }
  };

  const count = data?.replies?.length ?? null;

  return (
    <div className="mt-3">
      <button
        type="button"
        data-testid={`wall-reply-toggle-${wallPostId}`}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] transition ${
          open ? "text-[#FF5A00]" : "text-zinc-500 hover:text-[#FF5A00]"
        }`}
      >
        <CornerDownRight size={12} />
        {open ? "Hide replies" : (count != null ? `${count} repl${count === 1 ? "y" : "ies"}` : "Reply")}
      </button>

      {open && (
        <div className="mt-3 pl-4 border-l border-zinc-900 flex flex-col gap-3" data-testid={`wall-replies-${wallPostId}`}>
          {!data && <div className="text-xs text-zinc-600">Loading…</div>}
          {data?.replies?.length === 0 && (
            <div className="text-xs text-zinc-600 italic">Be the first to reply.</div>
          )}
          {data?.replies?.map((r) => {
            const canDelete = r.author_id === currentUserId || ownerId === currentUserId;
            return (
              <div key={r.reply_id} className="flex gap-2" data-testid={`wall-reply-${r.reply_id}`}>
                <div className="w-6 h-6 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center text-[10px] shrink-0">
                  {r.author?.avatar_path ? (
                    <img src={fileUrl(r.author.avatar_path)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-heading">{(r.author?.handle?.[0] || "?").toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-zinc-500">
                    <Link to={`/u/${r.author?.handle}`} className="text-zinc-300 hover:text-[#FF5A00]">#{r.author?.handle}</Link>
                    <span className="mx-1">·</span>{timeAgo(r.created_at)}
                    {r.edited_at && <span className="ml-1 uppercase text-[9px] tracking-wider text-zinc-600">· edited</span>}
                  </div>
                  <div className="text-sm whitespace-pre-wrap break-words mt-0.5">{r.content}</div>
                  <ReactionsBar kind="wall_reply" targetId={r.reply_id} />
                </div>
                {canDelete && (
                  <button
                    onClick={() => remove(r.reply_id)}
                    data-testid={`wall-reply-delete-${r.reply_id}`}
                    className="text-zinc-600 hover:text-red-400 p-1 self-start"
                    aria-label="Delete reply"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}

          {data?.can_reply ? (
            <form onSubmit={send} className="flex gap-2 mt-1">
              <input
                data-testid={`wall-reply-input-${wallPostId}`}
                className="flex-1 bg-zinc-950 border border-zinc-900 rounded-full px-3 py-1.5 text-sm outline-none focus:border-[#FF5A00]"
                placeholder="Reply…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1000}
              />
              <button
                data-testid={`wall-reply-send-${wallPostId}`}
                disabled={!text.trim() || busy}
                className="bg-[#FF5A00] disabled:bg-zinc-800 text-black px-3 rounded-full"
                aria-label="Send reply"
              >
                <Send size={14} />
              </button>
            </form>
          ) : data && (
            <div className="text-[11px] text-zinc-600 italic">Replies restricted by the wall owner.</div>
          )}
        </div>
      )}
    </div>
  );
}
