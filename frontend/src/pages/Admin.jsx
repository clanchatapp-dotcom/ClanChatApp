import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, FileText, AlertTriangle, Eye, EyeOff, KeyRound } from "lucide-react";

const TABS = [
  { id: "reports", label: "Reports" },
  { id: "csam", label: "CSAM queue" },
  { id: "watchlist", label: "Watchlist" },
  { id: "users", label: "Users" },
  { id: "audit", label: "Audit log" },
];

export default function Admin() {
  const [tab, setTab] = useState("reports");
  const [stats, setStats] = useState(null);
  const [reports, setReports] = useState([]);
  const [csam, setCsam] = useState([]);
  const [audit, setAudit] = useState([]);
  const [watched, setWatched] = useState([]);
  const [watchInput, setWatchInput] = useState("");
  const [watchReason, setWatchReason] = useState("");
  const [lookupHandle, setLookupHandle] = useState("");
  const [lookupUser, setLookupUser] = useState(null);
  const [flagReason, setFlagReason] = useState("");

  const loadStats = () => api.get("/admin/stats").then((r) => setStats(r.data)).catch(() => {});
  const loadReports = () => api.get("/admin/reports?status=pending").then((r) => setReports(r.data.reports)).catch(() => {});
  const loadCsam = () => api.get("/admin/csam/queue?status=queued").then((r) => setCsam(r.data.queue)).catch(() => {});
  const loadAudit = () => api.get("/admin/audit?limit=100").then((r) => setAudit(r.data.events)).catch(() => {});
  const loadWatched = () => api.get("/admin/watch").then((r) => setWatched(r.data.watched)).catch(() => {});

  useEffect(() => { loadStats(); }, []);
  useEffect(() => {
    if (tab === "reports") loadReports();
    if (tab === "csam") loadCsam();
    if (tab === "audit") loadAudit();
    if (tab === "watchlist") loadWatched();
  }, [tab]);

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
        <div className="flex flex-col gap-2">
          {reports.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">All caught up.</div>}
          {reports.map((r) => (
            <div key={r.report_id} className="border border-zinc-900 rounded-2xl p-3 text-sm" data-testid={`report-${r.report_id}`}>
              <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                <span className="bg-zinc-900 px-2 py-0.5 rounded uppercase tracking-wider">{r.target_type}</span>
                <span className="bg-red-500/10 text-red-300 px-2 py-0.5 rounded uppercase tracking-wider">{r.category}</span>
                <span>by #{r.reporter?.handle}</span>
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

              <p className="text-[10px] text-zinc-600 leading-relaxed">
                Minors cannot post NSFW (hardcoded). Adults cannot follow/DM/invite minors unless minor initiates (hardcoded). 18+ creators are invisible to minors in search. Every change is audit-logged.
              </p>
            </div>
          )}
        </div>
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
          Purges every related record: posts, comments, follows, IC, DMs, groups, boards, walls, reports, CSAM, tags, blocks, mutes, restricts. The calling admin is never deleted, even via the "purge all" option.
        </p>
      </section>
    </div>
  );
}
