import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { formatApiError } from "../lib/api";
import { toast } from "sonner";

/**
 * Shown when a Supabase (Google / email) sign-in succeeds but the user has
 * no ClanChat profile yet — the backend asked for a # handle + date of birth
 * so minor-protection rules apply from the very first record.
 *
 * Rendered globally by App.js whenever `pendingProfile` is set, so it works
 * no matter which route the OAuth redirect lands on.
 */
export default function CompleteProfile() {
  const { pendingProfile, completeSupabaseProfile, logout } = useAuth();
  const nav = useNavigate();
  const [handle, setHandle] = useState("");
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const data = await completeSupabaseProfile(dob, handle);
      if (data?.needs_profile) {
        setErr("That handle is taken or the details were invalid — try another handle.");
        setBusy(false);
        return;
      }
      toast.success("You're all set");
      nav("/feed", { replace: true });
    } catch (e2) {
      setErr(formatApiError(e2.response?.data?.detail) || e2.message);
      setBusy(false);
    }
  };

  const cancel = async () => {
    try { await logout(); } catch { /* ignore */ }
    nav("/login", { replace: true });
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm overflow-y-auto">
      <div className="px-6 pt-16 pb-24 min-h-screen max-w-md mx-auto" data-testid="complete-profile">
        <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">ClanChat</p>
        <h1 className="font-heading text-4xl mt-3">Almost there</h1>
        <p className="text-zinc-500 mt-2 text-sm">
          {pendingProfile?.email ? <>Signed in as <b className="text-zinc-300">{pendingProfile.email}</b>. </> : null}
          Pick your # handle and date of birth to finish.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3 mt-8">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">#</span>
            <input
              data-testid="cp-handle"
              className="cc-input pl-7"
              placeholder="handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              required
              autoFocus
            />
          </div>
          <label className="text-xs uppercase tracking-[0.2em] text-zinc-500 mt-2">Date of birth</label>
          <input
            data-testid="cp-dob"
            className="cc-input"
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
          />
          <p className="text-xs text-zinc-500">Self-declared. Minor protection rules apply for under-18 accounts.</p>
          {err && <div className="text-sm text-red-400" data-testid="cp-error">{err}</div>}
          <button data-testid="cp-submit" className="cc-btn-primary mt-3" disabled={busy}>
            {busy ? "Saving…" : "Finish signup"}
          </button>
          <button
            type="button"
            onClick={cancel}
            data-testid="cp-cancel"
            className="text-xs text-zinc-500 hover:text-zinc-300 mt-1 self-center"
          >
            Cancel and sign out
          </button>
        </form>
      </div>
    </div>
  );
}
