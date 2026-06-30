import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError, rememberToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";

export default function AuthCallback() {
  const nav = useNavigate();
  const { setUser } = useAuth();
  const processed = useRef(false);
  const [needsProfile, setNeedsProfile] = useState(null); // {google_email, google_name}
  const [dob, setDob] = useState("");
  const [handle, setHandle] = useState("");
  const sessionIdRef = useRef("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const hash = window.location.hash || "";
    const m = hash.match(/session_id=([^&]+)/);
    if (!m) { nav("/login"); return; }
    sessionIdRef.current = m[1];
    (async () => {
      try {
        const { data } = await api.post("/auth/google-session", { session_id: m[1] });
        if (data.needs_profile) {
          setNeedsProfile(data);
        } else {
          if (data.access_token) await rememberToken(data.access_token);
          setUser(data.user);
          window.history.replaceState({}, "", "/feed");
          nav("/feed", { replace: true });
        }
      } catch (e) {
        toast.error(formatApiError(e.response?.data?.detail) || e.message);
        nav("/login", { replace: true });
      }
    })();
  }, [nav, setUser]);

  const completeProfile = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/auth/google-session", {
        session_id: sessionIdRef.current,
        dob,
        handle,
      });
      if (data.access_token) await rememberToken(data.access_token);
      setUser(data.user);
      window.history.replaceState({}, "", "/feed");
      nav("/feed", { replace: true });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  if (needsProfile) {
    return (
      <div className="px-6 pt-16 pb-24 min-h-screen">
        <h1 className="font-heading text-3xl">Almost there</h1>
        <p className="text-zinc-500 mt-2 text-sm">
          Signed in as <b>{needsProfile.google_email}</b>. Set your # handle and date of birth.
        </p>
        <form onSubmit={completeProfile} className="flex flex-col gap-3 mt-6">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">#</span>
            <input data-testid="onb-handle" className="cc-input pl-7" placeholder="handle" required
              value={handle} onChange={e => setHandle(e.target.value.toLowerCase())} />
          </div>
          <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Date of birth</label>
          <input data-testid="onb-dob" className="cc-input" type="date" required
            value={dob} onChange={e => setDob(e.target.value)} />
          <button className="cc-btn-primary mt-3" disabled={busy} data-testid="onb-submit">
            {busy ? "Saving…" : "Finish signup"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen text-zinc-500">
      <div className="animate-pulse">Connecting…</div>
    </div>
  );
}
