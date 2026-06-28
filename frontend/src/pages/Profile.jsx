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
      .catch((e) => { 
        toast.error(formatApiError(e.response?.data?.detail)); 
        nav("/admin"); 
      })
      .finally(() => setLoading(false));
  }, [userId, nav]);

  const unwatch = async () => {
    if (!window.confirm("Remove from watchlist? Their privacy is restored. (Audit log keeps the history.)")) return;
    try {
      await api.delete(`/admin/watch/${userId}`);
      toast.success("Removed from watchlist · audit logged");
      nav("/admin");
    } catch (e) { 
      toast.error(formatApiError(e.response?.data?.detail)); 
    }
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
          Silent investigation view. <strong className="font-semibold">#{t?.handle} is not notified.</strong> Every action you take here is audit-logged.
        </span>
      </div>

      <section className="flex items-center gap-4 mt-4">
        <div className="w-16 h-16 rounded-full bg-zinc-900 overflow-hidden flex items-center justify-center">
          {t?.avatar_path ? (
            <img src={fileUrl(t.avatar_path)} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="font-heading text-2xl text-zinc-500">{t?.handle?.[0]?.toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="font-heading text-2xl">#{t?.handle}</div>
          <div className="text-xs text-zinc
