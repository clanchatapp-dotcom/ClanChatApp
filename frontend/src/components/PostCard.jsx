import { Heart, MoreHorizontal, Sparkles, Pin } from "lucide-react";
import { useState } from "react";
import TierBadge from "./TierBadge";
import api, { fileUrl, formatApiError } from "../lib/api";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";

function timeAgo(iso) {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return d.toLocaleDateString();
}

export default function PostCard({ post, onChange, showPin = false }) {
  const [liked, setLiked] = useState(post.liked);
  const [count, setCount] = useState(post.like_count);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const toggleLike = async () => {
    if (busy) return;
    setBusy(true);
    setLiked(!liked);
    setCount(c => c + (liked ? -1 : 1));
    try {
      const { data } = await api.post(`/posts/${post.post_id}/like`);
      setLiked(data.liked);
    } catch (e) {
      setLiked(liked);
      setCount(post.like_count);
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const pin = async () => {
    try {
      await api.post(`/posts/${post.post_id}/pin`);
      toast.success("Pin updated");
      onChange?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const remove = async () => {
    setConfirmOpen(false);
    setDeleted(true); // optimistic hide
    try {
      await api.delete(`/posts/${post.post_id}`);
      toast.success("Deleted");
      onChange?.();
    } catch (e) {
      setDeleted(false);
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  if (deleted) return null;

  return (
    <article
      data-testid={`post-${post.post_id}`}
      className="bg-zinc-950/60 light:bg-white/80 border border-zinc-900 rounded-3xl p-5 flex flex-col gap-4 fade-up"
    >
      <header className="flex items-center justify-between gap-3">
        <Link to={`/u/${post.author?.handle}`} className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden text-zinc-400 text-sm shrink-0">
            {post.author?.avatar_path ? (
              <img src={fileUrl(post.author.avatar_path)} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="font-heading">{(post.author?.handle?.[0] || "?").toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">#{post.author?.handle}</div>
            <div className="text-xs text-zinc-500">{timeAgo(post.created_at)}</div>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          {post.pinned && <Pin size={14} className="text-[#FF5A00]" />}
          {post.is_ai && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-zinc-400 bg-zinc-900 px-2 py-1 rounded">
              <Sparkles size={10} /> AI
            </span>
          )}
          {post.nsfw && (
            <span className="text-[10px] uppercase tracking-[0.15em] text-red-400 bg-red-500/10 px-2 py-1 rounded border border-red-500/20">18+</span>
          )}
          <TierBadge tier={post.tier} />
        </div>
      </header>

      {post.content && (
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{post.content}</p>
      )}

      {post.media?.length > 0 && (
        <div className={`grid gap-2 ${post.media.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {post.media.map((m, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950">
              {/\.(mp4|webm|mov)$/i.test(m) ? (
                <video src={fileUrl(m)} controls className="w-full h-full object-cover" />
              ) : (
                <img src={fileUrl(m)} alt="" className="w-full h-full object-cover" />
              )}
            </div>
          ))}
        </div>
      )}

      {post.tags?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {post.tags.map(t => (
            <Link to={`/t/${t}`} key={t} className="tag-chip" data-testid={`tag-${t}`}>#{t}</Link>
          ))}
        </div>
      )}

      <footer className="flex items-center justify-between pt-1 border-t border-zinc-900">
        <button
          data-testid={`like-btn-${post.post_id}`}
          onClick={toggleLike}
          className={`flex items-center gap-2 text-sm transition-colors ${liked ? "text-[#FF5A00]" : "text-zinc-400 hover:text-zinc-200"}`}
        >
          <Heart size={18} fill={liked ? "#FF5A00" : "none"} />
          <span>{count}</span>
        </button>
        <div className="flex items-center gap-3 text-zinc-500">
          {showPin && (
            <button onClick={pin} data-testid={`pin-btn-${post.post_id}`} className="text-xs uppercase tracking-wider hover:text-zinc-200">
              {post.pinned ? "Unpin" : "Pin"}
            </button>
          )}
          {showPin && (
            <button onClick={() => setConfirmOpen(true)} data-testid={`del-btn-${post.post_id}`} className="text-xs uppercase tracking-wider hover:text-red-400">Delete</button>
          )}
          <MoreHorizontal size={18} />
        </div>
      </footer>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-zinc-950 border border-zinc-800 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">Delete this post?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-500">
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="confirm-cancel" className="bg-transparent border-zinc-800 text-zinc-300 hover:bg-zinc-900">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="confirm-delete" onClick={remove} className="bg-red-500 hover:bg-red-600 text-white">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
