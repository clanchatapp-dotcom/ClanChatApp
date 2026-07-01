import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, FileText, AlertTriangle, Eye, EyeOff, KeyRound } from "lucide-react";

const TABS = [
  { id: "reports", label: "Reports" },
  { id: "csam", label: "CSAM queue" },
  { id: "watchlist", label: "Watchlist" },
  { id: "users", label: "User lookup" },
  { id: "all_users", label: "All users" },
  { id: "words", label: "Blocked words" },
  { id: "resets", label: "Password resets" },
  { id: "audit", label: "Audit log" },
];

export default function Admin() {
  const [tab, setTab] = useState("reports");
  const [stats, setStats] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportsGrouped, setReportsGrouped] = useState([]);
  const [reportsMode, setReportsMode] = useState("grouped"); // grouped | flat
  const [reportsCategory, setReportsCategory] = useState(""); // "" = all
  const [reportsCategoryCounts, setReportsCategoryCounts] = useState({ counts: {}, total: 0 });
  const [csam, setCsam] = useState([]);
  const [audit, setAudit] = useState([]);
  const [watched, setWatched] = useState([]);
  const [watchInput, setWatchInput] = useState("");
  const [watchReason, setWatchReason] = useState("");
  const [lookupHandle, setLookupHandle] = useState("");
  const [lookupUser, setLookupUser] = useState(null);
  const [flagReason, setFlagReason] = useState("");
  const [resetRequests, setResetRequests] = useState([]);

  const loadStats = () => api.get("/admin/stats").then((r) => setStats(r.data)).catch(() => {});
  const loadReports = () => {
    const params = new URLSearchParams({ status: "pending" });
    if (reportsCategory) params.set("category", reportsCategory);
    if (reportsMode === "grouped") params.set("grouped", "true");
    api.get(`/admin/reports?${params.toString()}`)
      .then((r) => {
        if (reportsMode === "grouped") { setReportsGrouped(r.data.grouped || []); }
        else { setReports(r.data.reports || []); }
      })
      .catch(() => {});
    api.get("/admin/reports/categories?status=pending")
      .then((r) => setReportsCategoryCounts(r.data))
      .catch(() => {});
  };
  const loadCsam = () => api.get("/admin/csam/queue?status=queued").then((r) => setCsam(r.data.queue)).catch(() => {});
  const loadAudit = () => api.get("/admin/audit?limit=100").then((r) => setAudit(r.data.events)).catch(() => {});
  const loadWatched = () => api.get("/admin/watch").then((r) => setWatched(r.data.watched)).catch(() => {});
  const loadResetRequests = () => api.get("/admin/password-resets?status=open").then((r) => setResetRequests(r.data.requests)).catch(() => {});

  useEffect(() => { loadStats(); }, []);
  useEffect(() => {
    if (tab === "reports") loadReports();
    if (tab === "csam") loadCsam();
    if (tab === "audit") loadAudit();
    if (tab === "watchlist") loadWatched();
    if (tab === "resets") loadResetRequests();
  }, [tab, reportsMode, reportsCategory]);

  const strike = async (id, level) => {
    const reason = window.prompt(`Reason for Strike ${level}?`, "Community guidelines violation");
    if (!reason) return;
    try {
      await api.post(`/admin/reports/${id}/strike?level=${level}&reason=${encodeURIComponent(reason)}`);
      toast.success(`Strike ${level} applied`);
      loadStats(); loadReports();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const dismiss = async (id) => {
    try { await api.post(`/admin/reports/${id}/dismiss`); loadReports(); toast.success("Dismissed"); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const confirmCsam = async (id) => {
    if (!window.confirm("Confirm CSAM? This will permanently delete the content and apply Strike 3 (account deletion) on the author. Cannot be undone.")) return;
    try {
      await api.post(`/admin/csam/${id}/confirm`);
      toast.success("Escalated · audit logged");
      loadStats(); loadCsam();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const clearCsam = async (id) => {
    if (!window.confirm("Mark as false alarm? Content will be restored. Audit trail kept.")) return;
    try {
      await api.post(`/admin/csam/${id}/clear`);
      toast.success("Cleared · content restored");
      loadStats(); loadCsam();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const promote = async () => {
    const email = window.prompt("Promote which email to admin?");
    if (!email) return;
    try {
      await api.post("/admin/promote", { email });
      toast.success(`${email} is now admin`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const purge = async (includeSeededAdmin) => {
    const msg = includeSeededAdmin
      ? "Purge ALL demo accounts INCLUDING admin@clanchat.app and every trace of their data? This cannot be undone."
      : "Purge alice/bob/teen and all their data (admin@clanchat.app kept)? This cannot be undone.";
    if (!window.confirm(msg)) return;
    if (includeSeededAdmin && !window.confirm("Last check: you are about to delete the seeded admin account. Make sure you've promoted your own email to admin FIRST. Continue?")) return;
    try {
      const { data } = await api.post("/admin/purge-demo-accounts", { include_seeded_admin: includeSeededAdmin });
      toast.success(`Purged ${data.purged.length} account(s)`);
      loadStats();
      console.info("Purge summary", data.summary);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const addToWatchlist = async () => {
    const handle = watchInput.trim().replace(/^#/, "");
    const reason = watchReason.trim();
    if (!handle) { toast.error("Enter a # handle"); return; }
    if (!reason) { toast.error("Reason required (audit trail)"); return; }
    try {
      // First resolve handle → user_id
      const { data: u } = await api.get(`/users/by-handle/${handle}`);
      await api.post(`/admin/watch/${u.user.user_id}`, { reason });
      toast.success(`Watching #${handle} silently · audit logged`);
      setWatchInput(""); setWatchReason("");
      loadWatched();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "User not found"); }
  };

  const removeFromWatchlist = async (uid, handle) => {
    if (!window.confirm(`Stop watching #${handle}? Privacy restored. Audit log keeps the record.`)) return;
    try {
      await api.delete(`/admin/watch/${uid}`);
      toast.success("Removed · audit logged");
      loadWatched();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const lookupByHandle = async () => {
    const h = lookupHandle.trim().replace(/^#/, "");
    if (!h) { toast.error("Enter a handle"); return; }
    try {
      const { data } = await api.get(`/admin/users/by-handle/${h}`);
      setLookupUser(data);
    } catch (e) { setLookupUser(null); toast.error(formatApiError(e.response?.data?.detail) || "Not found"); }
  };

  const reloadLookup = async () => {
    if (!lookupUser) return;
    try {
      const { data } = await api.get(`/admin/users/by-handle/${lookupUser.handle}`);
      setLookupUser(data);
    } catch { /* keep current view */ }
  };

  const toggleMinorLock = async () => {
    if (!lookupUser) return;
    const willLock = !lookupUser.minor_locked_by_admin;
    if (willLock && !flagReason.trim()) { toast.error("Reason required (audit trail)"); return; }
    if (willLock && !window.confirm(`Lock #${lookupUser.handle} as a MINOR? Hardcoded adult-minor protections apply (no NSFW, adults can't follow/DM unless minor-initiated).`)) return;
    try {
      await api.post(`/admin/users/${lookupUser.user_id}/mark-minor`, { locked: willLock, reason: flagReason.trim() });
      toast.success(willLock ? "Locked as minor · audit logged" : "Minor lock removed");
      setFlagReason(""); reloadLookup();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const toggleCreatorFlag = async () => {
    if (!lookupUser) return;
    const willFlag = !lookupUser.flagged_18plus_by_admin;
    if (willFlag && !flagReason.trim()) { toast.error("Reason required (audit trail)"); return; }
    if (willFlag && !window.confirm(`Flag #${lookupUser.handle} as a 18+ content creator? They'll be invisible to minors in search and NSFW posting is enabled for them.`)) return;
    try {
      await api.post(`/admin/users/${lookupUser.user_id}/mark-18plus`, { is_creator: willFlag, reason: flagReason.trim() });
      toast.success(willFlag ? "Flagged as 18+ creator · audit logged" : "18+ flag removed");
      setFlagReason(""); reloadLookup();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const resetPassword = async () => {
    if (!lookupUser) return;
    if (lookupUser.auth_provider === "google") {
      toast.error("This account signs in with Google — password can't be reset here.");
      return;
    }
    const reason = window.prompt(
      `Reset password for #${lookupUser.handle}? Enter the audit reason (e.g. "User contacted support — forgot password").`,
      ""
    );
    if (reason === null) return;
    if (!reason.trim()) { toast.error("Reason required"); return; }
    const newPw = window.prompt(
      `Enter a temporary password for #${lookupUser.handle} (min 8 chars). Pass this to them out-of-band; they should change it on first sign-in.`,
      ""
    );
    if (newPw === null) return;
    if (!newPw || newPw.length < 8) { toast.error("Password must be at least 8 chars"); return; }
    try {
      await api.post(`/admin/users/${lookupUser.user_id}/reset-password`, {
        new_password: newPw,
        reason: reason.trim(),
      });
      toast.success(`Password reset for #${lookupUser.handle} · audit logged`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  // ---- Reusable moderation actions (warn / strike / ban / unban) ----
  // These call the new /admin/users/:uid/{warn,strike,ban,unban} endpoints
  // and are wired to both the single-user lookup card and each row of the
  // "All users" tab.
  const warnUser = async (uid, handle, onDone) => {
    const reason = window.prompt(`Send a soft warning to #${handle}? Enter the reason.`, "");
    if (reason === null) return;
    if (!reason.trim()) { toast.error("Reason required"); return; }
    try {
      await api.post(`/admin/users/${uid}/warn`, { reason: reason.trim() });
      toast.success(`Warning sent to #${handle}`);
      onDone?.();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const strikeUser = async (uid, handle, level, onDone) => {
    const labels = { 1: "48h suspension", 2: "7-day suspension", 3: "account deletion" };
    if (!window.confirm(`Strike ${level} on #${handle} — ${labels[level]}. Continue?`)) return;
    const reason = window.prompt(`Reason for Strike ${level} on #${handle}?`, "Community guidelines violation");
    if (reason === null) return;
    if (!reason.trim()) { toast.error("Reason required"); return; }
    try {
      await api.post(`/admin/users/${uid}/strike?level=${level}`, { reason: reason.trim() });
      toast.success(`Strike ${level} applied to #${handle}`);
      onDone?.();
      loadStats();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const banUser = async (uid, handle, onDone) => {
    const hoursStr = window.prompt(`Ban #${handle} for how many hours? (1-8760)`, "24");
    if (hoursStr === null) return;
    const hours = parseInt(hoursStr, 10);
    if (!Number.isFinite(hours) || hours < 1 || hours > 8760) {
      toast.error("Hours must be between 1 and 8760 (1 year)"); return;
    }
    const reason = window.prompt(`Reason for the ban? (audit trail)`, "");
    if (reason === null) return;
    if (!reason.trim()) { toast.error("Reason required"); return; }
    try {
      const { data } = await api.post(`/admin/users/${uid}/ban`, { reason: reason.trim(), hours });
      toast.success(`Banned #${handle} until ${new Date(data.suspended_until).toLocaleString()}`);
      onDone?.();
      loadStats();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const unbanUser = async (uid, handle, onDone) => {
    if (!window.confirm(`Lift suspension for #${handle}? (Strike history is kept.)`)) return;
    const reason = window.prompt(`Reason for lifting the ban?`, "");
    if (reason === null) return;
    if (!reason.trim()) { toast.error("Reason required"); return; }
    try {
      await api.post(`/admin/users/${uid}/unban`, { reason: reason.trim() });
      toast.success(`#${handle} unbanned`);
      onDone?.();
      loadStats();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };


  if (!stats) return <div className="p-10 text-zinc-500 text-sm">Loading admin…</div>;

  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center justify-between mb-5">
        <h1 className="font-heading text-3xl flex items-center gap-2">
          <ShieldCheck size={22} className="text-[#FF5A00]" /> Admin
        </h1>
        <div className="flex items-center gap-3">
          <Link to="/admin/showcase" data-testid="admin-showcase-link" className="text-zinc-500 text-xs hover:text-zinc-300">Showcase</Link>
          <Link to="/feed" className="text-zinc-500 text-sm">Back</Link>
        </div>
      </header>

      <section className="grid grid-cols-3 gap-2 mb-6">
        {[
          ["Users", stats.users], ["Posts", stats.posts], ["Pending reports", stats.pending_reports],
          ["CSAM queue", stats.csam_queue], ["Suspended", stats.suspended], ["Deleted", stats.deleted],
        ].map(([k, v]) => (
          <div key={k} className="border border-zinc-900 rounded-xl p-3" data-testid={`stat-${k.toLowerCase().replace(/\s/g, "-")}`}>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</div>
            <div className="text-xl font-heading mt-1">{v}</div>
          </div>
        ))}
      </section>

      {stats.csam_queue > 0 && (
        <div className="mb-4 p-3 border border-red-500/40 bg-red-500/5 rounded-xl flex items-center gap-2">
          <ShieldAlert size={16} className="text-red-400" />
          <span className="text-sm text-red-200">{stats.csam_queue} CSAM report(s) awaiting review — content is auto-quarantined.</span>
        </div>
      )}

      <div className="flex gap-1 mb-4 border-b border-zinc-900 overflow-x-auto no-scrollbar -mx-5 px-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            data-testid={`admin-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`shrink-0 px-3 py-2 text-[11px] uppercase tracking-[0.12em] border-b-2 transition whitespace-nowrap ${
              tab === t.id ? "border-[#FF5A00] text-[#FF5A00]" : "border-transparent text-zinc-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "reports" && (
        <div className="flex flex-col gap-3" data-testid="admin-reports-panel">
          {/* Filter bar — mode toggle, category filter, per-category counts */}
          <div className="border border-zinc-900 rounded-2xl p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mr-1">View</div>
              <button
                data-testid="reports-mode-grouped"
                onClick={() => setReportsMode("grouped")}
                className={`text-xs py-1 px-2.5 rounded-full border ${reportsMode === "grouped" ? "border-[#FF5A00] text-[#FF5A00]" : "border-zinc-800 text-zinc-400"}`}
              >Grouped</button>
              <button
                data-testid="reports-mode-flat"
                onClick={() => setReportsMode("flat")}
                className={`text-xs py-1 px-2.5 rounded-full border ${reportsMode === "flat" ? "border-[#FF5A00] text-[#FF5A00]" : "border-zinc-800 text-zinc-400"}`}
              >Flat</button>
              <select
                data-testid="reports-category-filter"
                value={reportsCategory}
                onChange={(e) => setReportsCategory(e.target.value)}
                className="cc-input text-xs py-1.5 ml-auto"
              >
                <option value="">All categories ({reportsCategoryCounts.total})</option>
                {[
                  ["csam", "CSAM"],
                  ["underage", "Underage"],
                  ["harassment", "Harassment"],
                  ["hate", "Hate"],
                  ["self_harm", "Self-harm"],
                  ["inappropriate", "Inappropriate"],
                  ["unlabelled_ai", "Unlabelled AI"],
                  ["impersonation", "Impersonation"],
                  ["spam", "Spam"],
                  ["other", "Other"],
                ].map(([id, label]) => (
                  <option key={id} value={id}>
                    {label} ({reportsCategoryCounts.counts?.[id] || 0})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Grouped view — each row aggregates reports on the same target
              with the same category, so admins see "12 people reported this"
              rather than 12 rows. Reporter identities are hashed, not shown. */}
          {reportsMode === "grouped" && (
            <>
              {reportsGrouped.length === 0 && (
                <div className="text-zinc-600 text-sm text-center py-8">All caught up.</div>
              )}
              {reportsGrouped.map((g) => (
                <div
                  key={`${g.target_type}-${g.target_id}-${g.category}`}
                  className="border border-zinc-900 rounded-2xl p-3 text-sm"
                  data-testid={`report-group-${g.target_id}-${g.category}`}
                >
                  <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2 flex-wrap">
                    <span className="bg-zinc-900 px-2 py-0.5 rounded uppercase tracking-wider">{g.target_type}</span>
                    <span className={`px-2 py-0.5 rounded uppercase tracking-wider ${g.category === "csam" ? "bg-red-500/20 text-red-200" : "bg-red-500/10 text-red-300"}`}>{g.category}</span>
                    <span className="bg-orange-500/10 text-orange-200 px-2 py-0.5 rounded font-semibold">
                      {g.distinct_reporters} reporter{g.distinct_reporters === 1 ? "" : "s"} · {g.count} report{g.count === 1 ? "" : "s"}
                    </span>
                    <span className="ml-auto text-zinc-600">latest {new Date(g.latest).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-zinc-500 mb-2">
                    Target: <code className="text-zinc-400">{g.target_id}</code>
                  </div>
                  {g.sample_notes.length > 0 && (
                    <div className="border border-zinc-900 rounded-xl p-2 mb-2 text-[11px] text-zinc-400 space-y-1">
                      {g.sample_notes.map((n, i) => (
                        <div key={i} className="truncate">&ldquo;{n}&rdquo;</div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    {/* Actions apply to the first report_id in the group;
                        strike endpoints treat this as the source-of-truth. */}
                    <button
                      data-testid={`group-strike-1-${g.target_id}`}
                      onClick={() => strike(g.sample_report_ids[0], 1)}
                      className="cc-btn-secondary text-xs py-1 px-2"
                    >Strike 1 · 48h</button>
                    <button
                      data-testid={`group-strike-2-${g.target_id}`}
                      onClick={() => strike(g.sample_report_ids[0], 2)}
                      className="cc-btn-secondary text-xs py-1 px-2"
                    >Strike 2 · 7d</button>
                    <button
                      data-testid={`group-strike-3-${g.target_id}`}
                      onClick={() => strike(g.sample_report_ids[0], 3)}
                      className="bg-red-500 text-white text-xs py-1 px-2 rounded-full"
                    >Strike 3 · Delete</button>
                    <button
                      data-testid={`group-dismiss-${g.target_id}`}
                      onClick={async () => {
                        for (const rid of g.sample_report_ids) { await dismiss(rid); }
                        loadReports();
                      }}
                      className="text-zinc-500 text-xs py-1 px-2 ml-auto"
                    >Dismiss all</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Flat view — one row per report, reporter identity replaced with
              a hash so mass-reporters can be spotted without unmasking. */}
          {reportsMode === "flat" && (
            <>
              {reports.length === 0 && (
                <div className="text-zinc-600 text-sm text-center py-8">All caught up.</div>
              )}
              {reports.map((r) => (
                <div key={r.report_id} className="border border-zinc-900 rounded-2xl p-3 text-sm" data-testid={`report-${r.report_id}`}>
                  <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1 flex-wrap">
                    <span className="bg-zinc-900 px-2 py-0.5 rounded uppercase tracking-wider">{r.target_type}</span>
                    <span className={`px-2 py-0.5 rounded uppercase tracking-wider ${r.category === "csam" ? "bg-red-500/20 text-red-200" : "bg-red-500/10 text-red-300"}`}>{r.category}</span>
                    <span title="Hashed reporter — same hash across reports = same reporter, but identity is not revealed here">
                      reporter <code className="text-zinc-600">{r.reporter_hash?.slice(0, 8) || "—"}</code>
                    </span>
                  </div>
                  {r.notes && <p className="text-sm text-zinc-300">{r.notes}</p>}
                  <div className="text-xs text-zinc-500 mt-1">Target: <code className="text-zinc-400">{r.target_id}</code></div>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button data-testid={`strike-1-${r.report_id}`} onClick={() => strike(r.report_id, 1)} className="cc-btn-secondary text-xs py-1 px-2">Strike 1 · 48h</button>
                    <button data-testid={`strike-2-${r.report_id}`} onClick={() => strike(r.report_id, 2)} className="cc-btn-secondary text-xs py-1 px-2">Strike 2 · 7d</button>
                    <button data-testid={`strike-3-${r.report_id}`} onClick={() => strike(r.report_id, 3)} className="bg-red-500 text-white text-xs py-1 px-2 rounded-full">Strike 3 · Delete</button>
                    <button data-testid={`dismiss-${r.report_id}`} onClick={() => dismiss(r.report_id)} className="text-zinc-500 text-xs py-1 px-2 ml-auto">Dismiss</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "csam" && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-zinc-600 mb-2">Content is auto-quarantined the moment a CSAM report arrives. Confirm = permanent delete + Strike 3. Clear = false alarm + restore. Every action is audit-logged.</p>
          {csam.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">Queue is empty.</div>}
          {csam.map((c) => (
            <div key={c.csam_id} className="border border-red-500/30 bg-red-500/5 rounded-2xl p-3 text-sm" data-testid={`csam-${c.csam_id}`}>
              <div className="flex items-center gap-2 text-xs mb-2">
                <ShieldAlert size={12} className="text-red-400" />
                <span className="bg-red-500/20 text-red-200 px-2 py-0.5 rounded uppercase tracking-wider">CSAM</span>
                <span className="bg-zinc-900 px-2 py-0.5 rounded uppercase tracking-wider">{c.target_type}</span>
                {c.target_meta?.quarantined && <span className="text-[10px] text-amber-300 uppercase tracking-wider">Quarantined</span>}
              </div>
              <div className="text-xs text-zinc-400">
                Author: #{c.target_meta?.author_handle || "—"} · Media: {c.target_meta?.media_count ?? 0} · Reported by #{c.reporter_handle}
              </div>
              <div className="text-[11px] text-zinc-600 mt-1">Target: <code className="text-zinc-500">{c.target_id}</code></div>
              <div className="flex gap-2 mt-3">
                <button data-testid={`csam-confirm-${c.csam_id}`} onClick={() => confirmCsam(c.csam_id)} className="bg-red-500 text-white text-xs py-1.5 px-3 rounded-full">Confirm · escalate</button>
                <button data-testid={`csam-clear-${c.csam_id}`} onClick={() => clearCsam(c.csam_id)} className="cc-btn-secondary text-xs py-1.5 px-3">False alarm · clear</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "watchlist" && (
        <div className="flex flex-col gap-3">
          <div className="p-3 border border-amber-500/30 bg-amber-500/5 rounded-2xl">
            <div className="flex items-center gap-2 mb-1">
              <Eye size={14} className="text-amber-300" />
              <h3 className="text-xs uppercase tracking-[0.25em] text-amber-200">Silent surveillance</h3>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Watched accounts have NO indication. You can view all their posts (every tier including Inner Circle), DMs, group chats, and IC relationships. Every add / remove / view is audit-logged. Use for investigating reports — un-watch as soon as the question is resolved.
            </p>
          </div>

          <div className="flex flex-col gap-2 border border-zinc-900 rounded-2xl p-3">
            <label className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">Add to watchlist</label>
            <input
              data-testid="watch-add-handle"
              value={watchInput}
              onChange={(e) => setWatchInput(e.target.value)}
              placeholder="# handle (e.g. bob123)"
              className="cc-input text-sm"
            />
            <textarea
              data-testid="watch-add-reason"
              value={watchReason}
              onChange={(e) => setWatchReason(e.target.value)}
              placeholder="Reason — audit trail requires this (e.g. 'Report #r_abc — alleged harassment')"
              className="cc-input text-sm min-h-[60px] resize-none"
              maxLength={500}
            />
            <button data-testid="watch-add-submit" onClick={addToWatchlist} className="cc-btn-primary text-xs py-2 self-end inline-flex items-center gap-1.5">
              <Eye size={12} /> Start watching
            </button>
          </div>

          {watched.length === 0 && <div className="text-zinc-600 text-sm text-center py-6">No accounts on the watchlist.</div>}
          {watched.map((w) => (
            <div key={w.watch_id} className="border border-zinc-900 rounded-2xl p-3 flex items-center gap-3" data-testid={`watch-row-${w.target.handle}`}>
              <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center shrink-0">
                <span className="font-heading text-zinc-500">{w.target.handle?.[0]?.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">#{w.target.handle}</div>
                <div className="text-[11px] text-zinc-500 truncate">{w.reason}</div>
                <div className="text-[10px] text-zinc-700 mt-0.5">Added {new Date(w.added_at).toLocaleString()}</div>
              </div>
              <Link
                to={`/admin/watch/${w.target.user_id}`}
                data-testid={`watch-view-${w.target.handle}`}
                className="cc-btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1.5"
              >
                <Eye size={12} /> View
              </Link>
              <button
                data-testid={`watch-remove-${w.target.handle}`}
                onClick={() => removeFromWatchlist(w.target.user_id, w.target.handle)}
                className="cc-btn-secondary text-xs py-1.5 px-3 border-emerald-500/40 text-emerald-200 inline-flex items-center gap-1.5"
              >
                <EyeOff size={12} /> Stop
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "users" && (
        <div className="flex flex-col gap-3">
          <div className="p-3 border border-zinc-900 bg-zinc-950 rounded-2xl">
            <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-2">Lookup user by handle</div>
            <div className="flex gap-2">
              <input
                data-testid="user-lookup-handle"
                className="cc-input text-sm flex-1"
                placeholder="# handle"
                value={lookupHandle}
                onChange={(e) => setLookupHandle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookupByHandle()}
              />
              <button data-testid="user-lookup-submit" onClick={lookupByHandle} className="cc-btn-primary text-xs py-2 px-4">Lookup</button>
            </div>
          </div>

          {lookupUser && (
            <div className="border border-zinc-900 rounded-2xl p-4 flex flex-col gap-3" data-testid={`user-card-${lookupUser.handle}`}>
              <div>
                <div className="font-heading text-xl">#{lookupUser.handle}</div>
                <div className="text-xs text-zinc-500">{lookupUser.display_name} · {lookupUser.email}</div>
                <div className="text-[11px] text-zinc-600 mt-1">DOB: {lookupUser.dob || "—"} · role: {lookupUser.role} · strikes: {lookupUser.strikes}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="border border-zinc-900 rounded-xl p-2">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">is_minor</div>
                  <div className={`font-medium ${lookupUser.is_minor ? "text-amber-300" : "text-zinc-300"}`}>{String(lookupUser.is_minor)}</div>
                  <div className="text-[10px] text-zinc-600 mt-0.5">
                    DOB-derived: {String(lookupUser.dob_derived_minor)}
                    {lookupUser.minor_locked_by_admin && " · admin-locked"}
                  </div>
                  {lookupUser.minor_locked_reason && (
                    <div className="text-[10px] text-zinc-500 mt-1 italic">{lookupUser.minor_locked_reason}</div>
                  )}
                </div>
                <div className="border border-zinc-900 rounded-xl p-2">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">18+ creator</div>
                  <div className={`font-medium ${lookupUser.nsfw_account ? "text-fuchsia-300" : "text-zinc-300"}`}>{String(lookupUser.nsfw_account)}</div>
                  <div className="text-[10px] text-zinc-600 mt-0.5">
                    {lookupUser.flagged_18plus_by_admin ? "admin-flagged" : "—"}
                  </div>
                  {lookupUser.flagged_18plus_reason && (
                    <div className="text-[10px] text-zinc-500 mt-1 italic">{lookupUser.flagged_18plus_reason}</div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">Reason (required when applying a new flag)</label>
                <textarea
                  data-testid="user-flag-reason"
                  className="cc-input text-sm min-h-[50px] resize-none mt-1"
                  placeholder={`e.g. 'Creator application approved — report #...' OR 'Safety hold pending age verification'`}
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  maxLength={500}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  data-testid="user-toggle-minor"
                  onClick={toggleMinorLock}
                  disabled={lookupUser.nsfw_account && !lookupUser.minor_locked_by_admin}
                  className={`text-xs py-1.5 px-3 rounded-full transition border disabled:opacity-40 disabled:cursor-not-allowed ${
                    lookupUser.minor_locked_by_admin ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-zinc-800 hover:border-amber-500/40"
                  }`}
                >
                  {lookupUser.minor_locked_by_admin ? "Unlock minor" : "Lock as minor"}
                </button>
                <button
                  data-testid="user-toggle-18plus"
                  onClick={toggleCreatorFlag}
                  disabled={(lookupUser.minor_locked_by_admin || lookupUser.dob_derived_minor) && !lookupUser.flagged_18plus_by_admin}
                  className={`text-xs py-1.5 px-3 rounded-full transition border disabled:opacity-40 disabled:cursor-not-allowed ${
                    lookupUser.flagged_18plus_by_admin ? "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200" : "border-zinc-800 hover:border-fuchsia-500/40"
                  }`}
                >
                  {lookupUser.flagged_18plus_by_admin ? "Remove 18+ flag" : "Flag as 18+ creator"}
                </button>
                <button
                  data-testid="user-reset-password"
                  onClick={resetPassword}
                  disabled={lookupUser.auth_provider === "google"}
                  className="text-xs py-1.5 px-3 rounded-full transition border border-zinc-800 hover:border-sky-500/40 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={lookupUser.auth_provider === "google" ? "Google sign-in users manage their password via Google" : "Issue a temporary password"}
                >
                  <KeyRound size={11} /> Reset password
                </button>
              </div>

              {/* Moderation actions — warn / strike / ban / unban */}
              <div className="border-t border-zinc-900 pt-3 mt-1">
                <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-2">Moderation</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    data-testid="user-warn"
                    onClick={() => warnUser(lookupUser.user_id, lookupUser.handle, reloadLookup)}
                    className="text-xs py-1.5 px-3 rounded-full transition border border-zinc-800 hover:border-yellow-500/40 hover:text-yellow-200"
                  >
                    Warn
                  </button>
                  <button
                    data-testid="user-strike-1"
                    onClick={() => strikeUser(lookupUser.user_id, lookupUser.handle, 1, reloadLookup)}
                    className="text-xs py-1.5 px-3 rounded-full transition border border-amber-500/40 text-amber-200"
                  >
                    Strike 1 · 48h
                  </button>
                  <button
                    data-testid="user-strike-2"
                    onClick={() => strikeUser(lookupUser.user_id, lookupUser.handle, 2, reloadLookup)}
                    className="text-xs py-1.5 px-3 rounded-full transition border border-orange-500/40 text-orange-200"
                  >
                    Strike 2 · 7d
                  </button>
                  <button
                    data-testid="user-strike-3"
                    onClick={() => strikeUser(lookupUser.user_id, lookupUser.handle, 3, reloadLookup)}
                    className="text-xs py-1.5 px-3 rounded-full transition bg-red-500 text-white"
                  >
                    Strike 3 · Delete
                  </button>
                  {(lookupUser.suspended || lookupUser.deleted) ? (
                    <button
                      data-testid="user-unban"
                      onClick={() => unbanUser(lookupUser.user_id, lookupUser.handle, reloadLookup)}
                      className="text-xs py-1.5 px-3 rounded-full transition border border-emerald-500/40 text-emerald-200"
                    >
                      Unban / restore
                    </button>
                  ) : (
                    <button
                      data-testid="user-ban"
                      onClick={() => banUser(lookupUser.user_id, lookupUser.handle, reloadLookup)}
                      className="text-xs py-1.5 px-3 rounded-full transition border border-red-500/40 text-red-200"
                    >
                      Manual ban…
                    </button>
                  )}
                </div>
                {lookupUser.suspended && lookupUser.suspended_until && (
                  <div className="text-[11px] text-amber-300 mt-2">
                    Currently suspended until {new Date(lookupUser.suspended_until).toLocaleString()}
                  </div>
                )}
                {lookupUser.deleted && (
                  <div className="text-[11px] text-red-300 mt-2">
                    Account is deleted (strike 3 or manual delete). Unban restores it.
                  </div>
                )}
              </div>

              <p className="text-[10px] text-zinc-600 leading-relaxed">
                Minors cannot post NSFW (hardcoded). Adults cannot follow/DM/invite minors unless minor initiates (hardcoded). 18+ creators are invisible to minors in search. Every change is audit-logged.
              </p>
            </div>
          )}
        </div>
      )}

      {tab === "all_users" && (
        <AllUsersPanel
          warnUser={warnUser}
          strikeUser={strikeUser}
          banUser={banUser}
          unbanUser={unbanUser}
        />
      )}

      {tab === "words" && (
        <BlockedWordsPanel />
      )}

      {tab === "audit" && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-2">
            <FileText size={11} /> Compliance audit · append-only
          </div>
          {audit.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">No events yet.</div>}
          {audit.map((e, i) => (
            <div key={`${e.at}-${i}`} className="border border-zinc-900 rounded-lg p-2.5 text-xs font-mono" data-testid={`audit-${i}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-zinc-500">{new Date(e.at).toLocaleString()}</span>
                <span className="bg-zinc-900 text-zinc-300 px-2 py-0.5 rounded">{e.event}</span>
                {e.target_type && <span className="text-zinc-600">{e.target_type}:{(e.target_id || "").slice(0, 16)}</span>}
                {e.admin_id && <span className="text-zinc-600">admin:{e.admin_id.slice(0, 10)}</span>}
              </div>
            </div>
          ))}
          {audit.length > 0 && (
            <div className="text-[10px] text-zinc-700 mt-3 flex items-center gap-1">
              <AlertTriangle size={10} /> Records are immutable. Export by querying GET /api/admin/audit.
            </div>
          )}
        </div>
      )}

      {tab === "resets" && (
        <PasswordResetsPanel
          requests={resetRequests}
          reload={loadResetRequests}
        />
      )}

      <section className="mt-10 border border-red-500/30 bg-red-500/5 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={14} className="text-red-400" />
          <h3 className="text-xs uppercase tracking-[0.25em] text-red-200">Danger zone</h3>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">
          One-off bootstrap for production. Promote your real email to admin, sign in as that account,
          then purge the seeded demo accounts (alice / bob / teen) and optionally the seeded admin too.
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <button data-testid="admin-promote-btn" onClick={promote} className="cc-btn-secondary text-xs py-1.5 px-3">
            Promote email to admin…
          </button>
          <button data-testid="admin-purge-demo-btn" onClick={() => purge(false)} className="cc-btn-secondary text-xs py-1.5 px-3 border-amber-500/40 text-amber-200">
            Purge alice / bob / teen
          </button>
          <button data-testid="admin-purge-all-btn" onClick={() => purge(true)} className="bg-red-500 text-white text-xs py-1.5 px-3 rounded-full">
            Purge ALL demo (incl. seeded admin)
          </button>
        </div>
        <p className="text-[10px] text-zinc-600 mt-3 leading-relaxed">
          Purges every related record: posts, comments, follows, IC, DMs, groups, boards, walls, reports, CSAM, tags, blocks, mutes, restricts. The calling admin is never deleted, even via the &quot;purge all&quot; option.
        </p>
      </section>
    </div>
  );
}

/**
 * Password-reset request queue. Users who can't sign in submit a ticket
 * from /forgot-password. Admins:
 *
 *   1. See the ticket here with email + handle + (optional) verification
 *      reason the user provided.
 *   2. Contact the user out-of-band (their own email, phone, etc.) to
 *      confirm it's really them — never trust the form alone.
 *   3. If satisfied, click "Reset password" which jumps to the Users tab
 *      pre-filled. Issue a temp password with the existing reset tool.
 *   4. Click "Mark resolved" to close the ticket.
 *
 * Every action is audit-logged via the underlying admin endpoints.
 */
function PasswordResetsPanel({ requests, reload }) {
  const close = async (id) => {
    if (!window.confirm("Mark this reset request resolved?")) return;
    try {
      await api.post(`/admin/password-resets/${id}/close`);
      toast.success("Closed");
      reload();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  return (
    <div className="flex flex-col gap-2" data-testid="admin-password-resets">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-2">
        <KeyRound size={11} /> Open requests
      </div>
      {requests.length === 0 && (
        <div className="text-zinc-600 text-sm text-center py-8">No open password-reset requests.</div>
      )}
      {requests.map((r) => (
        <div
          key={r.request_id}
          className="border border-zinc-900 rounded-2xl p-3 flex flex-col gap-2"
          data-testid={`reset-${r.request_id}`}
        >
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500 flex-wrap">
            <span className="text-zinc-400">{new Date(r.created_at).toLocaleString()}</span>
            {r.target_user_id ? (
              <span className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">Match found</span>
            ) : (
              <span className="bg-amber-500/10 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">No match</span>
            )}
          </div>
          <div className="text-sm">
            <span className="text-zinc-400">Email </span>
            <span className="font-mono text-zinc-200">{r.email}</span>
          </div>
          <div className="text-sm">
            <span className="text-zinc-400">Handle </span>
            <span className="font-mono text-zinc-200">#{r.handle}</span>
          </div>
          {r.reason && (
            <div className="text-xs text-zinc-300 bg-zinc-900/40 rounded-lg p-2 border border-zinc-800">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">User says</div>
              {r.reason}
            </div>
          )}
          <div className="flex gap-2 mt-1">
            {r.target_handle && (
              <a
                href={`#users-${r.target_handle}`}
                onClick={(e) => {
                  e.preventDefault();
                  // Hand the handle off to the Users tab — they paste into
                  // the lookup box, then use the existing "Reset password"
                  // button on the user card.
                  navigator.clipboard?.writeText(r.target_handle).catch(() => {});
                  toast.info(`#${r.target_handle} copied. Switch to the Users tab and paste.`);
                }}
                data-testid={`reset-jump-${r.request_id}`}
                className="text-xs py-1.5 px-3 rounded-full border border-sky-500/40 text-sky-200 hover:bg-sky-500/10 inline-flex items-center gap-1"
              >
                <KeyRound size={11} /> Copy handle &amp; open Users
              </a>
            )}
            <button
              data-testid={`reset-close-${r.request_id}`}
              onClick={() => close(r.request_id)}
              className="text-xs py-1.5 px-3 rounded-full border border-zinc-800 hover:border-emerald-500/40 hover:text-emerald-200"
            >
              Mark resolved
            </button>
          </div>
        </div>
      ))}
      <p className="text-[10px] text-zinc-600 leading-relaxed mt-2">
        We never confirm to the requester whether the email/handle exists — that prevents account enumeration. Always verify the user out-of-band (DM, secondary email, phone) before issuing a temp password.
      </p>
    </div>
  );
}

/**
 * All-users directory. Paginated list with search + status filter and
 * inline moderation actions on every row. Handles active/suspended/deleted
 * accounts the same way — the row buttons swap between Ban and Unban based
 * on current state.
 */
function AllUsersPanel({ warnUser, strikeUser, banUser, unbanUser }) {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(false);
  const limit = 25;

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/users", {
        params: { q, status, limit, skip },
      });
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [status, skip]);

  const submitSearch = (e) => { e.preventDefault(); setSkip(0); load(); };
  const reloadCurrent = () => load();

  return (
    <div className="flex flex-col gap-3" data-testid="admin-all-users">
      <form onSubmit={submitSearch} className="flex flex-wrap gap-2 items-center border border-zinc-900 rounded-2xl p-3">
        <input
          data-testid="all-users-search"
          className="cc-input text-sm flex-1 min-w-[180px]"
          placeholder="Search handle, email or display name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          data-testid="all-users-status"
          className="cc-input text-sm py-2"
          value={status}
          onChange={(e) => { setSkip(0); setStatus(e.target.value); }}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="deleted">Deleted</option>
        </select>
        <button type="submit" data-testid="all-users-search-submit" className="cc-btn-primary text-xs py-2 px-4">Search</button>
      </form>

      <div className="text-[11px] text-zinc-500 flex items-center justify-between">
        <span>
          {loading ? "Loading…" : `Showing ${users.length} of ${total} account${total === 1 ? "" : "s"}`}
        </span>
        <span className="flex items-center gap-2">
          <button
            data-testid="all-users-prev"
            onClick={() => setSkip(Math.max(0, skip - limit))}
            disabled={skip === 0}
            className="px-2 py-1 border border-zinc-800 rounded disabled:opacity-30"
          >Prev</button>
          <button
            data-testid="all-users-next"
            onClick={() => setSkip(skip + limit)}
            disabled={skip + limit >= total}
            className="px-2 py-1 border border-zinc-800 rounded disabled:opacity-30"
          >Next</button>
        </span>
      </div>

      {users.length === 0 && !loading && (
        <div className="text-zinc-600 text-sm text-center py-8">No accounts match.</div>
      )}

      {users.map((u) => (
        <div
          key={u.user_id}
          className="border border-zinc-900 rounded-2xl p-3 flex flex-col gap-2"
          data-testid={`all-users-row-${u.handle}`}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-9 h-9 rounded-full bg-zinc-900 flex items-center justify-center shrink-0">
              <span className="font-heading text-zinc-500">{u.handle?.[0]?.toUpperCase()}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">#{u.handle}</div>
              <div className="text-[11px] text-zinc-500 truncate">{u.display_name} · {u.email}</div>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {u.role === "admin" && <span className="text-[10px] uppercase tracking-wider bg-sky-500/10 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded">Admin</span>}
              {u.deleted && <span className="text-[10px] uppercase tracking-wider bg-red-500/10 text-red-300 border border-red-500/30 px-1.5 py-0.5 rounded">Deleted</span>}
              {u.suspended && !u.deleted && <span className="text-[10px] uppercase tracking-wider bg-amber-500/10 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">Suspended</span>}
              {u.is_minor && <span className="text-[10px] uppercase tracking-wider bg-amber-500/10 text-amber-200 border border-amber-500/20 px-1.5 py-0.5 rounded">Minor</span>}
              {u.nsfw_account && <span className="text-[10px] uppercase tracking-wider bg-fuchsia-500/10 text-fuchsia-200 border border-fuchsia-500/20 px-1.5 py-0.5 rounded">18+</span>}
              {u.strikes > 0 && <span className="text-[10px] uppercase tracking-wider bg-orange-500/10 text-orange-200 border border-orange-500/20 px-1.5 py-0.5 rounded">Strikes {u.strikes}</span>}
            </div>
          </div>

          {u.suspended_until && (
            <div className="text-[11px] text-amber-300">
              Until {new Date(u.suspended_until).toLocaleString()}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              data-testid={`row-warn-${u.handle}`}
              onClick={() => warnUser(u.user_id, u.handle, reloadCurrent)}
              className="text-[11px] py-1 px-2.5 rounded-full border border-zinc-800 hover:border-yellow-500/40 hover:text-yellow-200"
            >Warn</button>
            <button
              data-testid={`row-strike-1-${u.handle}`}
              onClick={() => strikeUser(u.user_id, u.handle, 1, reloadCurrent)}
              className="text-[11px] py-1 px-2.5 rounded-full border border-amber-500/40 text-amber-200"
            >S1 · 48h</button>
            <button
              data-testid={`row-strike-2-${u.handle}`}
              onClick={() => strikeUser(u.user_id, u.handle, 2, reloadCurrent)}
              className="text-[11px] py-1 px-2.5 rounded-full border border-orange-500/40 text-orange-200"
            >S2 · 7d</button>
            <button
              data-testid={`row-strike-3-${u.handle}`}
              onClick={() => strikeUser(u.user_id, u.handle, 3, reloadCurrent)}
              className="text-[11px] py-1 px-2.5 rounded-full bg-red-500 text-white"
            >S3 · Delete</button>
            {(u.suspended || u.deleted) ? (
              <button
                data-testid={`row-unban-${u.handle}`}
                onClick={() => unbanUser(u.user_id, u.handle, reloadCurrent)}
                className="text-[11px] py-1 px-2.5 rounded-full border border-emerald-500/40 text-emerald-200"
              >Unban</button>
            ) : (
              <button
                data-testid={`row-ban-${u.handle}`}
                onClick={() => banUser(u.user_id, u.handle, reloadCurrent)}
                className="text-[11px] py-1 px-2.5 rounded-full border border-red-500/40 text-red-200"
              >Ban…</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Blocked words moderation. Custom list overlays the hardcoded NSFW filter
 * for trending. Admins add exact-match or substring entries; built-ins are
 * read-only.
 */
function BlockedWordsPanel() {
  const [custom, setCustom] = useState([]);
  const [builtinExact, setBuiltinExact] = useState([]);
  const [builtinSub, setBuiltinSub] = useState([]);
  const [tag, setTag] = useState("");
  const [match, setMatch] = useState("exact");
  const [reason, setReason] = useState("");
  const [showBuiltin, setShowBuiltin] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/admin/moderation/blocked-tags");
      setCustom(data.tags || []);
      setBuiltinExact(data.builtin_exact || []);
      setBuiltinSub(data.builtin_substring || []);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    const cleaned = tag.trim().toLowerCase().replace(/^#/, "");
    if (!/^[a-z0-9]+$/.test(cleaned)) {
      toast.error("Tag must be lowercase letters/digits only (no spaces or punctuation)"); return;
    }
    try {
      await api.post("/admin/moderation/blocked-tags", { tag: cleaned, match, reason: reason.trim() });
      toast.success(`#${cleaned} blocked from trending`);
      setTag(""); setReason("");
      load();
    } catch (e2) { toast.error(formatApiError(e2.response?.data?.detail)); }
  };

  const remove = async (t) => {
    if (!window.confirm(`Unblock #${t}? It will be eligible to appear in trending again.`)) return;
    try {
      await api.delete(`/admin/moderation/blocked-tags/${t}`);
      toast.success(`#${t} removed from block list`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="admin-blocked-words">
      <div className="p-3 border border-zinc-900 bg-zinc-950 rounded-2xl">
        <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-2">Block a word from trending</div>
        <form onSubmit={add} className="flex flex-col gap-2">
          <div className="flex gap-2 flex-wrap">
            <input
              data-testid="block-tag-input"
              className="cc-input text-sm flex-1 min-w-[160px]"
              placeholder="e.g. yiff, thicc, snuff"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              maxLength={64}
            />
            <select
              data-testid="block-tag-match"
              className="cc-input text-sm py-2"
              value={match}
              onChange={(e) => setMatch(e.target.value)}
            >
              <option value="exact">Exact match</option>
              <option value="substring">Substring (careful — collisions)</option>
            </select>
          </div>
          <input
            data-testid="block-tag-reason"
            className="cc-input text-sm"
            placeholder="Reason (optional — kept in audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <button type="submit" data-testid="block-tag-submit" className="cc-btn-primary text-xs py-2 self-end">
            Block from trending
          </button>
        </form>
        <p className="text-[10px] text-zinc-600 leading-relaxed mt-2">
          <strong>Exact</strong> blocks the tag only when typed exactly (safe). <strong>Substring</strong> blocks any tag containing the term (broader — but be careful, e.g. blocking &quot;ass&quot; as a substring would also hide #class, #grass).
        </p>
      </div>

      <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">Custom block list ({custom.length})</div>
      {custom.length === 0 && (
        <div className="text-zinc-600 text-sm text-center py-6 border border-zinc-900 rounded-2xl">
          No custom blocks yet — the built-in NSFW list ({builtinExact.length + builtinSub.length} terms) is already active.
        </div>
      )}
      {custom.map((c) => (
        <div key={c.tag} className="border border-zinc-900 rounded-2xl p-3 flex items-center gap-3" data-testid={`blocked-tag-${c.tag}`}>
          <div className="flex-1 min-w-0">
            <div className="text-sm">
              <span className="text-[#FF5A00]">#</span>
              <span className="font-mono">{c.tag}</span>
              <span className="text-[10px] uppercase tracking-wider ml-2 text-zinc-500">{c.match}</span>
            </div>
            {c.reason && <div className="text-[11px] text-zinc-500 truncate">{c.reason}</div>}
            <div className="text-[10px] text-zinc-700 mt-0.5">Added {new Date(c.added_at).toLocaleString()}</div>
          </div>
          <button
            data-testid={`blocked-tag-remove-${c.tag}`}
            onClick={() => remove(c.tag)}
            className="text-[11px] py-1.5 px-3 rounded-full border border-emerald-500/40 text-emerald-200"
          >Unblock</button>
        </div>
      ))}

      <button
        type="button"
        data-testid="blocked-tag-toggle-builtin"
        onClick={() => setShowBuiltin(!showBuiltin)}
        className="text-[11px] text-zinc-500 hover:text-zinc-300 text-left mt-2"
      >
        {showBuiltin ? "Hide" : "Show"} built-in NSFW list ({builtinExact.length + builtinSub.length} terms — cannot be removed here)
      </button>
      {showBuiltin && (
        <div className="border border-zinc-900 rounded-2xl p-3 text-[11px] text-zinc-400 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Exact ({builtinExact.length})</div>
            <div className="flex flex-wrap gap-1">
              {builtinExact.map((t) => (
                <span key={`e-${t}`} className="bg-zinc-900 px-2 py-0.5 rounded text-zinc-400">{t}</span>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Substring ({builtinSub.length})</div>
            <div className="flex flex-wrap gap-1">
              {builtinSub.map((t) => (
                <span key={`s-${t}`} className="bg-zinc-900 px-2 py-0.5 rounded text-zinc-400">{t}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

