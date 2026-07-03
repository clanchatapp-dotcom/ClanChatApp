import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";

/**
 * VoiceRecorder — inline record-and-send widget for the DM composer.
 *
 * Flow:
 *   idle → user taps mic → recording (with elapsed timer + waveform pulse) →
 *   user taps stop → preview (playback + delete/send buttons) →
 *   user taps send → uploads to /api/upload → returns media path →
 *   parent calls onSend(path).
 *
 * Uses the standard MediaRecorder API. Works in every modern browser +
 * Capacitor Android WebView. Records as webm/opus (best available codec);
 * backend accepts anything and stores it under its uploaded MIME.
 *
 * Props:
 *   onSend(mediaPath)  — parent uploads then attaches to DM
 *   onCancel()         — user backed out entirely
 *   maxSeconds         — hard cap (default 120s = 2 min)
 */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];
function pickMime() {
  for (const m of MIME_CANDIDATES) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return ""; // browser picks default
}

export default function VoiceRecorder({ onSend, onCancel, maxSeconds = 120 }) {
  const [phase, setPhase] = useState("idle"); // idle | recording | preview | sending
  const [seconds, setSeconds] = useState(0);
  const [blobUrl, setBlobUrl] = useState(null);
  const blobRef = useRef(null);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const startedAt = useRef(0);
  const tickRef = useRef(null);

  const cleanup = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  };
  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        blobRef.current = blob;
        setBlobUrl(URL.createObjectURL(blob));
        setPhase("preview");
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };
      rec.start();
      startedAt.current = Date.now();
      setSeconds(0);
      setPhase("recording");
      tickRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt.current) / 1000);
        setSeconds(s);
        if (s >= maxSeconds) stopRec();
      }, 250);
    } catch (e) {
      // Common failure: permission denied. Show a clear message so the user
      // knows they need to allow mic access.
      toast.error(
        e?.name === "NotAllowedError"
          ? "Microphone permission denied. Enable it in your device settings and try again."
          : `Recording failed: ${e?.message || e?.name || "unknown"}`
      );
      onCancel?.();
    }
  };

  const stopRec = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    try { mediaRecRef.current?.stop(); } catch { /* already stopped */ }
  };

  const discard = () => {
    cleanup();
    setBlobUrl(null);
    blobRef.current = null;
    onCancel?.();
  };

  const send = async () => {
    if (!blobRef.current) return;
    setPhase("sending");
    try {
      const fd = new FormData();
      // Give the file a proper extension so the server MIME-detects correctly
      const ext = (blobRef.current.type || "").includes("mp4") ? "mp4"
        : (blobRef.current.type || "").includes("ogg") ? "ogg" : "webm";
      fd.append("file", blobRef.current, `voice-${Date.now()}.${ext}`);
      const { data } = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await onSend?.(data.path);
      cleanup();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Upload failed");
      setPhase("preview");
    }
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  // ---- Idle: single mic tap starts recording ----
  if (phase === "idle") {
    return (
      <button
        type="button"
        data-testid="dm-mic"
        onClick={start}
        className="p-2 text-zinc-500 hover:text-[#FF5A00]"
        aria-label="Record voice message"
        title="Record voice message"
      >
        <Mic size={16} />
      </button>
    );
  }

  // ---- Recording: pulsing red dot + timer + stop button ----
  if (phase === "recording") {
    return (
      <div
        className="flex items-center gap-2 bg-red-500/10 border border-red-500/40 rounded-full pl-2 pr-1 py-1"
        data-testid="dm-recording"
      >
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[11px] font-mono text-red-200">{mm}:{ss}</span>
        <button
          type="button"
          data-testid="dm-recording-stop"
          onClick={stopRec}
          className="p-1.5 rounded-full bg-red-500 text-white"
          aria-label="Stop recording"
          title="Stop"
        >
          <Square size={12} fill="currentColor" />
        </button>
      </div>
    );
  }

  // ---- Preview: playback + discard + send ----
  return (
    <div className="flex items-center gap-1.5 border border-zinc-800 rounded-full pl-1 pr-1 py-0.5" data-testid="dm-voice-preview">
      {blobUrl && (
        <audio
          src={blobUrl}
          controls
          className="h-7"
          style={{ maxWidth: 140 }}
          data-testid="dm-voice-audio"
        />
      )}
      <button
        type="button"
        data-testid="dm-voice-discard"
        onClick={discard}
        disabled={phase === "sending"}
        className="p-1.5 text-zinc-500 hover:text-red-400 disabled:opacity-40"
        aria-label="Discard"
        title="Discard"
      >
        <Trash2 size={13} />
      </button>
      <button
        type="button"
        data-testid="dm-voice-send"
        onClick={send}
        disabled={phase === "sending"}
        className="p-1.5 rounded-full bg-[#FF5A00] text-black disabled:opacity-40"
        aria-label="Send voice message"
        title="Send"
      >
        {phase === "sending" ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
      </button>
    </div>
  );
}
