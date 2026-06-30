import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Phone, PhoneOff, Video as VideoIcon } from "lucide-react";
import api, { fileUrl } from "../lib/api";
import { useAuth } from "../context/AuthContext";

/**
 * Mounts once at the app shell. Polls /calls/incoming every 3 seconds.
 * When a ringing call is found, freezes the rest of the UI behind a
 * fullscreen overlay until the user answers or declines. Auto-dismisses
 * if the caller hangs up first (the poll returns null).
 */
const POLL_MS = 3000;

export default function IncomingCallRinger() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [call, setCall] = useState(null);
  const [busy, setBusy] = useState(false);
  const audioRef = useRef(null);

  // Poll only while authenticated.
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const { data } = await api.get("/calls/incoming");
        if (!stopped) setCall(data.call || null);
      } catch { /* silent — next tick will retry */ }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [user]);

  // Play a subtle ringtone loop while the dialog is up. Capacitor WebView
  // allows looping audio after the first user gesture; on cold-load some
  // browsers will block — that's fine, the dialog itself is the alert.
  useEffect(() => {
    if (!call) { audioRef.current?.pause?.(); return; }
    const a = audioRef.current;
    if (a) { a.currentTime = 0; a.loop = true; a.play().catch(() => {}); }
  }, [call]);

  const answer = async () => {
    if (busy || !call) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/calls/${call.call_id}/answer`);
      setCall(null);
      nav(`/call/${call.call_id}`, { state: { session: data } });
    } catch { /* call expired or already answered elsewhere */ }
    finally { setBusy(false); }
  };
  const decline = async () => {
    if (busy || !call) return;
    setBusy(true);
    try { await api.post(`/calls/${call.call_id}/reject`); } catch { /* ignore */ }
    setCall(null);
    setBusy(false);
  };

  if (!call) return null;
  const isVideo = call.kind === "video";

  return (
    <div className="fixed inset-0 z-[120] bg-black/95 backdrop-blur flex flex-col items-center justify-center p-8" data-testid="incoming-call-dialog">
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=" />
      <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-6 inline-flex items-center gap-2">
        {isVideo ? <VideoIcon size={11} /> : <Phone size={11} />}
        Incoming {isVideo ? "video" : "voice"} call
      </div>
      <div className="w-24 h-24 rounded-full overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
        {call.caller?.avatar_path ? (
          <img src={fileUrl(call.caller.avatar_path)} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="font-heading text-2xl text-zinc-400">{call.caller?.handle?.[0]?.toUpperCase()}</span>
        )}
      </div>
      <div className="font-heading text-3xl mb-1">#{call.caller?.handle}</div>
      <div className="text-zinc-500 text-sm mb-10">{call.caller?.display_name}</div>
      <div className="flex items-center gap-8">
        <button
          data-testid="incoming-call-decline"
          onClick={decline}
          disabled={busy}
          className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center disabled:opacity-50"
          aria-label="Decline"
        >
          <PhoneOff size={22} />
        </button>
        <button
          data-testid="incoming-call-answer"
          onClick={answer}
          disabled={busy}
          className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center disabled:opacity-50"
          aria-label="Answer"
        >
          {isVideo ? <VideoIcon size={22} /> : <Phone size={22} />}
        </button>
      </div>
    </div>
  );
}
