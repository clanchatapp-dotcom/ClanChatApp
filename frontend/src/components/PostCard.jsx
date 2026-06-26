import { Heart, MoreHorizontal, Sparkles, Pin, MessageCircle, Flag, ShieldAlert } from "lucide-react";
import { useState } from "react";
import TierBadge from "./TierBadge";
import Comments from "./Comments";
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

export default function PostCard({ post, onChange, showPin = false, currentUserId }) {
  const [liked, setLiked] = useState(post.liked);
  const [count, setCount] = useState(post.like_count);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(post.comment_count || 0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCat, setReportCat] = useState("");
  const [reportNotes, setReportNotes] = useState("");

  const submitReport = async () => {
    if (!reportCat) { toast.error("Pick a reason"); return; }
    try {
      await api.post("/reports", {
        target_type: "post",
        target_id: post.post_id,
        category: reportCat,
        notes: reportNotes,
      });
      setReportOpen(false); setReportCat(""); setReportNotes("");
      toast.success(reportCat === "csam"
        ? "Reported. Content quarantined immediately."
        : "Reported. Thanks for keeping ClanChat safe.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const reloadCount = async () => {
    try {
      const { data } = await api.get(`/posts/${post.post_id}/comments`);
      setCommentCount(data.comments.length);
    } catch { /* ignore */ }
  };

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
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-zinc-300 bg-purple-500/10 border border-purple-500/30 px-2 py-1 rounded">
              <Sparkles size={10} /> AI {post.ai_label || ""}
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
          {post.media.map((m) => (
            <div key={m} className="overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950">
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
        <div className="flex items-center gap-4">
          <button
            data-testid={`like-btn-${post.post_id}`}
            onClick={toggleLike}
            className={`flex items-center gap-2 text-sm transition-colors ${liked ? "text-[#FF5A00]" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            <Heart size={18} fill={liked ? "#FF5A00" : "none"} />
            <span>{count}</span>
          </button>
          <button
            data-testid={`comment-toggle-${post.post_id}`}
            onClick={() => setCommentsOpen(o => !o)}
            className={`flex items-center gap-2 text-sm transition-colors ${commentsOpen ? "text-[#FF5A00]" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            <MessageCircle size={18} />
            <span>{commentCount}</span>
          </button>
        </div>
        <div className="flex items-center gap-3 text-zinc-500">
          {showPin && (
            <button onClick={pin} data-testid={`pin-btn-${post.post_id}`} className="text-xs uppercase tracking-wider hover:text-zinc-200">
              {post.pinned ? "Unpin" : "Pin"}
            </button>
          )}
          {showPin && (
            <button onClick={() => setConfirmOpen(true)} data-testid={`del-btn-${post.post_id}`} className="text-xs uppercase tracking-wider hover:text-red-400">Delete</button>
          )}
          {!showPin && post.author?.user_id !== currentUserId && (
            <button
              data-testid={`report-btn-${post.post_id}`}
              onClick={() => setReportOpen(true)}
              className="text-zinc-500 hover:text-red-400 inline-flex items-center gap-1 text-xs"
              title="Report"
            >
              <Flag size={14} />
            </button>
          )}
        </div>
      </footer>

      {commentsOpen && (
        <Comments post={post} currentUserId={currentUserId} onChange={reloadCount} />
      )}

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
      <AlertDialog open={reportOpen} onOpenChange={setReportOpen}>
        <AlertDialogContent className="bg-zinc-950 border border-zinc-800 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading flex items-center gap-2">
              <Flag size={16} className="text-red-400" /> Report this post
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-500">
              Your report is confidential. CSAM reports auto-quarantine the content immediately and route to our compliance queue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            {[
              { id: "csam", label: "Child sexual abuse material (CSAM)", danger: true },
              { id: "harassment", label: "Harassment or threats" },
              { id: "spam", label: "Spam or scam" },
              { id: "hate", label: "Hate speech" },
              { id: "self_harm", label: "Self-harm content" },
              { id: "impersonation", label: "Impersonation" },
              { id: "other", label: "Other" },
            ].map((opt) => (
              <label
                key={opt.id}
                className={`flex items-center justify-between p-3 border rounded-xl cursor-pointer ${
                  reportCat === opt.id
                    ? opt.danger ? "border-red-500/60 bg-red-500/10" : "border-[#FF5A00] bg-[#FF5A00]/5"
                    : "border-zinc-900"
                }`}
              >
                <span className={`text-sm inline-flex items-center gap-2 ${opt.danger ? "text-red-200" : ""}`}>
                  {opt.danger && <ShieldAlert size={14} className="text-red-400" />}
                  {opt.label}
                </span>
                <input
                  type="radio"
                  name={`report-${post.post_id}`}
                  checked={reportCat === opt.id}
                  onChange={() => setReportCat(opt.id)}
                  data-testid={`report-cat-${opt.id}-${post.post_id}`}
                  className={opt.danger ? "accent-red-500" : "accent-[#FF5A00]"}
                />
              </label>
            ))}
            <textarea
              data-testid={`report-notes-${post.post_id}`}
              className="cc-input mt-1 min-h-[60px] resize-none text-sm"
              placeholder="Optional context (helps reviewers)"
              value={reportNotes}
              onChange={(e) => setReportNotes(e.target.value)}
              maxLength={1000}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="report-cancel" className="bg-transparent border-zinc-800 text-zinc-300 hover:bg-zinc-900">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid={`report-submit-${post.post_id}`}
              onClick={submitReport}
              className={reportCat === "csam" ? "bg-red-500 hover:bg-red-600 text-white" : "bg-[#FF5A00] hover:bg-[#E65000] text-black"}
            >
              Send report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
