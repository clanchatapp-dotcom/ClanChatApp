import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { formatApiError, fileUrl } from "../lib/api";
import { toast } from "sonner";
import { ShieldCheck, BarChart3, AlertTriangle } from "lucide-react";

export default function Admin() {
  const [stats, setStats] = useState(null);
  const [reports, setReports] = useState([]);

  const load = async () => {
    try {
      const [s, r] = await Promise.all([
        api.get("/admin/stats"),
        api.get("/admin/reports?status=pending"),
      ]);
      setStats(s.data);
      setReports(r.data.reports);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, []);

  const strike = async (id, level) => {
    const reason = window.prompt(`Reason for Strike ${level}?`, "Community guidelines violation");
    if (!reason) return;
    try {
      await api.post(`/admin/reports/${id}/strike?level=${level}&reason=${encodeURIComponent(reason)}`);
      toast.success(`Strike ${level} applied`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const dismiss = async (id) => {
    try { await api.post(`/admin/reports/${id}/dismiss`); load(); toast.success("Dismissed"); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  if (!stats) return <div className="p-10 text-zinc-500 text-sm">Loading admin…</div>;

  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center justify-between mb-5">
        <h1 className="font-heading text-3xl flex items-center gap-2">
          <ShieldCheck size={22} className="text-[#FF5A00]" /> Admin
        </h1>
        <Link to="/feed" className="text-zinc-500 text-sm">Back</Link>
      </header>

      <section className="grid grid-cols-3 gap-2 mb-6">
        {[
          ["Users", stats.users], ["Posts", stats.posts], ["Pending reports", stats.pending_reports],
          ["CSAM queue", stats.csam_queue], ["Suspended", stats.suspended], ["Deleted", stats.deleted],
        ].map(([k, v]) => (
          <div key={k} className="border border-zinc-900 rounded-xl p-3" data-testid={`stat-${k.toLowerCase().replace(/\s/g,'-')}`}>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</div>
            <div className="text-xl font-heading mt-1">{v}</div>
          </div>
        ))}
      </section>

      <h2 className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-3">Pending reports</h2>
      {reports.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">All caught up.</div>}
      <div className="flex flex-col gap-2">
        {reports.map(r => (
          <div key={r.report_id} className="border border-zinc-900 rounded-2xl p-3 text-sm" data-testid={`report-${r.report_id}`}>
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
              <span className="bg-zinc-900 px-2 py-0.5 rounded uppercase tracking-wider">{r.target_type}</span>
              <span className="bg-red-500/10 text-red-300 px-2 py-0.5 rounded uppercase tracking-wider">{r.category}</span>
              <span>by #{r.reporter?.handle}</span>
            </div>
            {r.notes && <p className="text-sm text-zinc-300">{r.notes}</p>}
            <div className="text-xs text-zinc-500 mt-1">Target: <code className="text-zinc-400">{r.target_id}</code></div>
            <div className="flex gap-2 mt-3">
              <button data-testid={`strike-1-${r.report_id}`} onClick={() => strike(r.report_id, 1)} className="cc-btn-secondary text-xs py-1 px-2">Strike 1 · 48h</button>
              <button data-testid={`strike-2-${r.report_id}`} onClick={() => strike(r.report_id, 2)} className="cc-btn-secondary text-xs py-1 px-2">Strike 2 · 7d</button>
              <button data-testid={`strike-3-${r.report_id}`} onClick={() => strike(r.report_id, 3)} className="bg-red-500 text-white text-xs py-1 px-2 rounded-full">Strike 3 · Delete</button>
              <button data-testid={`dismiss-${r.report_id}`} onClick={() => dismiss(r.report_id)} className="text-zinc-500 text-xs py-1 px-2 ml-auto">Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
