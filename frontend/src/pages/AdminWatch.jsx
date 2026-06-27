import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import api, { formatApiError, fileUrl } from "../lib/api";
import { toast } from "sonner";
import { Eye, EyeOff, ArrowLeft, ShieldCheck, MessageCircle, FileText, Users, Flag } from "lucide-react";

const SUB_TABS = [
  { id: "posts", label: "Posts" },
  { id: "dms", label: "DMs" },
  { id: "groups", label: "Groups" },
  { id: "ic", label: "Inner Circle" },
  { id: "reports", label: "Reports against" },
];

export default function AdminWatch() {
  const { userId } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("posts");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/admin/watch/${userId}/overview`)
      .then((r) => setData(r.data))
      .catch((e) => { toast.error(formatApiError(e.response?.data?.detail)); nav("/admin"); })
      .finally(() => setLoading(false));
  }, [userId, nav]);

  const unwatch = async () => {
    if (!window.confirm("Remove from watchlist? Their privacy is restored. (Audit log keeps the history.)")) return;
    try {
      await api.delete(`/admin/watch/${userId}`);
      toast.success("Removed from watchlist · audit logged");
      nav("/admin");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  if (loading) return <div className="p-10 text-zinc-500 text-sm">Loading watch overview…</div>;
  if (!data) return null;

  const t = data.target;

  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center justify-between mb-5">
        <button onClick={() => nav("/admin")} className="text-zinc-500 inline-flex items-center gap-1 text-sm">
          <ArrowLeft size={16} /> Admin
        </button>
        <button
          onClick={unwatch}
          data-testid="watch-unwatch-btn"
          className="cc-btn-secondary text-xs py-1.5 px-3 border-emerald-500/40 text-emerald-200 inline-flex items-center gap-1.5"
        >
          <EyeOff size={12} /> Stop watching
        </button>
      </header>

      <div className="mb-2 p-3 border border-amber-500/30 bg-amber-500/5 rounded-xl text-xs text-amber-200 inline-flex items-start gap-2">
        <Eye size={14} className="shrink-0 mt-0.5" />
        <span>
          Silent investigation view. <strong className="font-semibold">#{t.handle} is not notified.</strong> Every action you take here is audit-logged.
        </span>
      </div>

      <section className="flex items-center gap-4 mt-4">
        <div className="w-16 h-16 rounded-full bg-zinc-900 overflow-hidden flex items-center justify-center">
          {t.avatar_path
            ? <img src={fileUrl(t.avatar_path)} alt="" className="w-full h-full object-cover" />
            : <span className="font-heading text-2xl text-zinc-500">{t.handle?.[0]?.toUpperCase()}</span>}
        </div>
        <div className="min-w-0">
          <div className="font-heading text-2xl">#{t.handle}</div>
          <div className="text-xs text-zinc-500 truncate">{t.display_name} · {t.email}</div>
          <div className="text-[10px] text-zinc-600 mt-0.5">
            {data.followers_count} followers · {data.following_count} following · is_minor: {String(!!t.is_minor)}
          </div>
        </div>
      </section>

      <div className="flex gap-1 mt-5 border-b border-zinc-900 overflow-x-auto">
        {SUB_TABS.map((s) => (
          <button
            key={s.id}
            data-testid={`watch-tab-${s.id}`}
            onClick={() => setTab(s.id)}
            className={`px-3 py-2 text-[11px] uppercase tracking-[0.2em] border-b-2 whitespace-nowrap transition ${
              tab === s.id ? "border-[#FF5A00] text-[#FF5A00]" : "border-transparent text-zinc-500"
            }`}
          >
            {s.label}
            {s.id === "posts" && ` (${data.post_count})`}
            {s.id === "dms" && ` (${data.dm_count})`}
            {s.id === "groups" && ` (${data.groups.length})`}
            {s.id === "ic" && ` (${data.inner_circle_members.length})`}
            {s.id === "reports" && ` (${data.reports_against.length})`}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "posts" && (
          <div className="flex flex-col gap-2">
            {data.posts.length === 0 && <div className="text-zinc-600 text-sm text-center py-6">No posts.</div>}
            {data.posts.map((p) => (
              <div key={p.post_id} className="border border-zinc-900 rounded-2xl p-3 text-sm" data-testid={`watch-post-${p.post_id}`}>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                  <span className={`px-2 py-0.5 rounded ${p.tier === "inner" ? "bg-purple-500/20 text-purple-200" : p.tier === "followers" ? "bg-blue-500/20 text-blue-200" : "bg-zinc-900"}`}>{p.tier}</span>
                  {p.quarantined && <span className="bg-red-500/20 text-red-200 px-2 py-0.5 rounded">quarantined</span>}
                  {p.nsfw && <span className="bg-amber-500/20 text-amber-200 px-2 py-0.5 rounded">18+</span>}
                  {p.is_ai && <span className="bg-fuchsia-500/20 text-fuchsia-200 px-2 py-0.5 rounded">AI</span>}
                  <span className="text-zinc-600 ml-auto">{new Date(p.created_at).toLocaleString()}</span>
                </div>
                <div className="whitespace-pre-wrap text-zinc-200">{p.content}</div>
                {p.media_paths?.length > 0 && (
  <div className="mt-2 flex flex-col gap-2">
    {p.media_paths.map((path, idx) => {
      const url = fileUrl(path);
      const isVideo = path.match(/\.(mp4|mov|webm|ogg)$/i);
      return isVideo ? (
        <video
          key={idx}
          src={url}
          controls
          className="w-full rounded-xl max-h-64 bg-zinc-900"
        />
      ) : (
        <img
          key={idx}
          src={url}
          alt="post media"
          className="w-full rounded-xl max-h-64 object-cover"
        />
      );
    })}
  </div>
)}
                {p.tags?.length > 0 && (
                  <div className="text-[10px] text-zinc-600 mt-1">#{p.tags.join(" #")}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "dms" && (
          <div className="flex flex-col gap-1">
            {data.dms.length === 0 && <div className="text-zinc-600 text-sm text-center py-6">No DMs.</div>}
            {data.dms.map((m) => {
              const outgoing = m.from_id === t.user_id;
              const counterpartId = outgoing ? m.to_id : m.from_id;
              const cp = data.counterparts[counterpartId];
              return (
                <div key={m.message_id} className="border border-zinc-900 rounded-xl p-2.5 text-sm" data-testid={`watch-dm-${m.message_id}`}>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 mb-1">
                    <MessageCircle size={11} />
                    <span className={outgoing ? "text-orange-300" : "text-cyan-300"}>{outgoing ? "→" : "←"}</span>
                    <span className="font-mono">#{cp?.handle || counterpartId.slice(0, 10)}</span>
                    {m.read === false && !outgoing && <span className="bg-amber-500/20 text-amber-200 px-1.5 py-0.5 rounded text-[9px]">UNREAD</span>}
                    <span className="ml-auto text-zinc-600">{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-zinc-200 break-words">{m.content}</div>
({m.media_paths?.length > 0 && (
  <div className="mt-2 flex flex-col gap-2">
    {m.media_paths.map((path, idx) => {
      const url = fileUrl(path);
      const isVideo = path.match(/\.(mp4|mov|webm|ogg)$/i);
      return isVideo ? (
        <video
          key={idx}
          src={url}
          controls
          className="w-full rounded-xl max-h-64 bg-zinc-900"
        />
      ) : (
        <img
          key={idx}
          src={url}
          alt="dm media"
          className="w-full rounded-xl max-h-64 object-cover"
        />
      );
    })}
  </div>
)}

        {tab === "groups" && (
          <div className="flex flex-col gap-2">
            {data.groups.length === 0 && <div className="text-zinc-600 text-sm text-center py-6">Not in any group chats.</div>}
            {data.groups.map((g) => (
              <div key={g.group_id} className="border border-zinc-900 rounded-2xl p-3 text-sm flex items-center justify-between">
                <div>
                  <div className="font-medium">{g.name || "(unnamed)"}</div>
                  <div className="text-[11px] text-zinc-500">{g.members} members</div>
                </div>
                <code className="text-[10px] text-zinc-600">{g.group_id}</code>
              </div>
            ))}
          </div>
        )}

        {tab === "ic" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-2">In #{t.handle}&apos;s circle</div>
              {data.inner_circle_members.length === 0 && <div className="text-zinc-600 text-sm">—</div>}
              {data.inner_circle_members.map((u) => (
                <Link key={u.user_id} to={`/admin/watch/${u.user_id}`} className="block py-1.5 px-2 rounded hover:bg-zinc-900 text-sm">#{u.handle}</Link>
              ))}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-2">#{t.handle} is in their circles</div>
              {data.inner_circle_of.length === 0 && <div className="text-zinc-600 text-sm">—</div>}
              {data.inner_circle_of.map((u) => (
                <Link key={u.user_id} to={`/admin/watch/${u.user_id}`} className="block py-1.5 px-2 rounded hover:bg-zinc-900 text-sm">#{u.handle}</Link>
              ))}
            </div>
          </div>
        )}

        {tab === "reports" && (
          <div className="flex flex-col gap-2">
            {data.reports_against.length === 0 && <div className="text-zinc-600 text-sm text-center py-6">No reports filed against this user.</div>}
            {data.reports_against.map((r) => (
              <div key={r.report_id} className="border border-zinc-900 rounded-2xl p-3 text-sm" data-testid={`watch-report-${r.report_id}`}>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                  <Flag size={11} className="text-red-400" />
                  <span className="bg-red-500/10 text-red-300 px-2 py-0.5 rounded">{r.category}</span>
                  <span>{r.status}</span>
                  <span className="ml-auto text-zinc-600">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                {r.notes && <div className="text-zinc-300">{r.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
