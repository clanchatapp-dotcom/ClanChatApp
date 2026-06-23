import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { fileUrl, formatApiError } from "../lib/api";
import { toast } from "sonner";

export default function TagApprovals() {
  const [pending, setPending] = useState([]);

  const load = () => api.get("/tags/pending").then(r => setPending(r.data.pending)).catch(() => {});
  useEffect(() => { load(); }, []);

  const act = async (tag_id, action) => {
    try {
      if (action === "approve") await api.post(`/tags/${tag_id}/approve`);
      else await api.post(`/tags/${tag_id}/reject`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center justify-between mb-5">
        <h1 className="font-heading text-3xl">Tag approvals</h1>
        <Link to="/notifications" className="text-zinc-500 text-sm">Back</Link>
      </header>
      <p className="text-xs text-zinc-500 mb-5">Tags on photo/video posts and 18+ posts always need your approval — no exceptions.</p>
      {pending.length === 0 && <div className="text-zinc-600 text-sm text-center py-10">No pending tags.</div>}
      <div className="flex flex-col gap-3">
        {pending.map(t => (
          <div key={t.tag_id} className="border border-zinc-900 rounded-2xl p-3" data-testid={`pending-tag-${t.tag_id}`}>
            <div className="text-xs text-zinc-500 mb-1">
              <Link className="text-zinc-300" to={`/u/${t.tagger.handle}`}>#{t.tagger.handle}</Link> tagged you
              {t.is_nsfw && <span className="ml-2 text-red-400 text-[10px] uppercase tracking-wider">18+</span>}
              {t.has_media && <span className="ml-2 text-purple-300 text-[10px] uppercase tracking-wider">Media</span>}
            </div>
            {t.post_excerpt && <p className="text-sm">&ldquo;{t.post_excerpt}&rdquo;</p>}
            {t.post_media?.[0] && (
              <img src={fileUrl(t.post_media[0])} alt="" className="mt-2 w-full max-w-xs rounded-xl object-cover" />
            )}
            <div className="flex gap-2 mt-3">
              <button data-testid={`approve-tag-${t.tag_id}`} onClick={() => act(t.tag_id, "approve")} className="cc-btn-primary text-xs py-1.5 px-3">Approve</button>
              <button data-testid={`reject-tag-${t.tag_id}`} onClick={() => act(t.tag_id, "reject")} className="cc-btn-secondary text-xs py-1.5 px-3">Reject</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
