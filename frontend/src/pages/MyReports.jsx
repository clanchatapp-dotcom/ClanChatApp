import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, ShieldOff, Loader2, Flag } from "lucide-react";
import api from "../lib/api";

/**
 * /me/reports — reporter follow-up page.
 *
 * Per spec: reporters see whether their report was reviewed and, if so,
 * whether the platform took action on it — but NEVER the specific moderation
 * reason. That stays private between the admin team and the reported user.
 * Keeps the moderation surface clean, protects reviewers from harassment,
 * and stops reporters from using this feed as a proxy for "did I get someone
 * banned?"
 */
const CATEGORY_LABELS = {
  csam: "CSAM",
  underage: "Underage account",
  harassment: "Harassment",
  hate: "Hate speech",
  self_harm: "Self-harm",
  inappropriate: "Inappropriate content",
  unlabelled_ai: "Unlabelled AI",
  impersonation: "Impersonation",
  spam: "Spam",
  other: "Other",
};

export default function MyReports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/me/reports");
        setReports(data.reports || []);
      } catch (e) {
        setErr(e.response?.data?.detail || "Could not load your reports.");
      } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-24" data-testid="my-reports">
      <div className="flex items-center gap-3 mb-4">
        <Link
          to="/settings"
          className="w-9 h-9 rounded-full border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200"
          data-testid="my-reports-back"
        >
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="font-heading text-xl">My reports</h1>
          <p className="text-[11px] text-zinc-500">
            Everything you've flagged, and whether the team took action.
          </p>
        </div>
      </div>

      <div className="border border-zinc-900 rounded-2xl p-3 text-[11px] text-zinc-500 mb-4 flex gap-2">
        <ShieldCheck size={14} className="text-emerald-400 shrink-0 mt-0.5" />
        <span>
          For your safety and the safety of everyone else, we don't share the specific reason a report was actioned or dismissed. Every report is reviewed by a real person — never a bot.
        </span>
      </div>

      {loading && (
        <div className="text-zinc-500 text-sm inline-flex items-center gap-2 py-6">
          <Loader2 className="animate-spin" size={14} /> Loading…
        </div>
      )}
      {err && <div className="text-red-400 text-sm py-4">{err}</div>}
      {!loading && !err && reports.length === 0 && (
        <div className="text-zinc-600 text-sm text-center py-10 border border-zinc-900 rounded-2xl">
          <Flag size={20} className="mx-auto mb-2 opacity-50" />
          You haven't reported anything yet. If you spot something that breaks the community guidelines, use the flag on any post.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {reports.map((r) => (
          <div
            key={r.report_id}
            className="border border-zinc-900 rounded-2xl p-3"
            data-testid={`my-report-${r.report_id}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm">
                <span className="text-zinc-200">{CATEGORY_LABELS[r.category] || r.category}</span>
                <span className="text-zinc-600 mx-2">·</span>
                <span className="text-zinc-500 text-[11px] uppercase tracking-wider">{r.target_type}</span>
              </div>
              <StatusPill outcome={r.outcome} />
            </div>
            <div className="text-[11px] text-zinc-600 mt-1">
              Filed {new Date(r.created_at).toLocaleString()}
              {r.reviewed_at && (
                <>
                  <span className="mx-1.5">·</span>
                  Reviewed {new Date(r.reviewed_at).toLocaleString()}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ outcome }) {
  if (outcome === "under_review") {
    return (
      <span data-testid={`report-status-${outcome}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-400">
        <Loader2 size={10} className="animate-spin" /> Under review
      </span>
    );
  }
  if (outcome === "actioned") {
    return (
      <span data-testid={`report-status-${outcome}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-200 bg-emerald-500/5">
        <ShieldCheck size={10} /> Actioned
      </span>
    );
  }
  return (
    <span data-testid={`report-status-${outcome}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-400">
      <ShieldOff size={10} /> Not actioned
    </span>
  );
}
