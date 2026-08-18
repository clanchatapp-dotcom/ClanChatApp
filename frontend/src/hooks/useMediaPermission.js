import { useState, useCallback } from "react";
import { ImagePlus, ShieldCheck, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Camera } from "@capacitor/camera";

const STORAGE_KEY = "clanchat_media_permission";

/**
 * Two-stage media permission gate.
 *
 *   const { ensureMediaPermission, MediaPermissionDialog } = useMediaPermission();
 *   const onAttachClick = async () => {
 *     if (!(await ensureMediaPermission())) return;
 *     fileRef.current?.click();
 *   };
 *   // Inside JSX: <MediaPermissionDialog />
 *
 * Flow:
 *   1. WEB ONLY  → show in-app consent sheet, remember answer in localStorage.
 *   2. NATIVE (Capacitor Android/iOS) → show the same friendly sheet for
 *      context, then on "Allow" call Camera.requestPermissions which fires
 *      the real OS-level dialog ("Allow ClanChat to access photos & media?").
 *      Without this the AndroidManifest entries alone never trigger a prompt
 *      because <input type="file"> goes through the Storage Access Framework
 *      which doesn't require the READ_MEDIA_* permissions to be granted —
 *      asking explicitly here is what lets the rest of the app use Camera
 *      APIs (and future native pickers) without re-prompting.
 */
export default function useMediaPermission() {
  const initial = (() => {
    try { return localStorage.getItem(STORAGE_KEY) === "granted"; }
    catch { return false; }
  })();
  const [granted, setGranted] = useState(initial);
  const [pending, setPending] = useState(null); // resolver fn while dialog is open
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ensureMediaPermission = useCallback(() => {
    if (granted) return Promise.resolve(true);
    setError("");
    return new Promise((resolve) => setPending(() => resolve));
  }, [granted]);

  const accept = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      // Trigger the real OS permission prompt when running inside the APK.
      // On the web this call is a no-op and just resolves immediately.
      if (Capacitor.isNativePlatform()) {
        const res = await Camera.requestPermissions({ permissions: ["photos", "camera"] });
        // Camera plugin returns { photos: 'granted' | 'denied' | 'prompt' | 'limited', camera: ... }
        const ok = res?.photos === "granted" || res?.photos === "limited";
        if (!ok) {
          setBusy(false);
          setError("Permission denied. Open phone Settings → Apps → ClanChat → Permissions to enable Photos & Videos.");
          return; // keep the dialog open so the user can read the hint
        }
      }
      try { localStorage.setItem(STORAGE_KEY, "granted"); } catch { /* ignore */ }
      setGranted(true);
      if (pending) { pending(true); setPending(null); }
    } catch (e) {
      setError(e?.message || "Couldn't request permission. Try again.");
    } finally {
      setBusy(false);
    }
  }, [pending]);

  const decline = useCallback(() => {
    if (pending) { pending(false); setPending(null); }
    setError("");
  }, [pending]);

  const MediaPermissionDialog = useCallback(() => {
    if (!pending) return null;
    return (
      <div
        className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm"
        data-testid="media-permission-dialog"
        onClick={busy ? undefined : decline}
      >
        <div
          className="relative w-full max-w-md mx-auto bg-zinc-950 border border-zinc-800 rounded-t-3xl sm:rounded-3xl p-6 pb-8 m-0 sm:m-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            data-testid="media-permission-close"
            onClick={decline}
            disabled={busy}
            className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 p-1 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} />
          </button>

          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 bg-[#FF5A00]/10 text-[#FF5A00]">
            <ImagePlus size={26} strokeWidth={1.6} />
          </div>

          <h2 className="font-heading text-2xl leading-tight mb-2">Allow ClanChat to access your photos &amp; videos?</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            We&apos;ll only use what you pick — nothing is read in the background, nothing is uploaded without you tapping send.
          </p>

          <ul className="text-xs text-zinc-500 mt-4 space-y-1.5">
            <li className="flex items-start gap-2"><ShieldCheck size={12} className="mt-0.5 text-emerald-400 shrink-0" /> You choose each file via the picker.</li>
            <li className="flex items-start gap-2"><ShieldCheck size={12} className="mt-0.5 text-emerald-400 shrink-0" /> Posts respect your tier choice (Public / Followers / Inner).</li>
            <li className="flex items-start gap-2"><ShieldCheck size={12} className="mt-0.5 text-emerald-400 shrink-0" /> DMs honour both parties&apos; screenshot setting.</li>
          </ul>

          {error ? (
            <p data-testid="media-permission-error" className="text-xs text-rose-400 mt-4 leading-relaxed bg-rose-500/5 border border-rose-500/20 rounded-lg p-3">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2 mt-7">
            <button
              data-testid="media-permission-decline"
              onClick={decline}
              disabled={busy}
              className="cc-btn-secondary flex-1 text-sm py-2.5 disabled:opacity-40"
            >
              Not now
            </button>
            <button
              data-testid="media-permission-allow"
              onClick={accept}
              disabled={busy}
              className="cc-btn-primary flex-1 text-sm py-2.5 disabled:opacity-60"
            >
              {busy ? "Requesting…" : "Allow"}
            </button>
          </div>

          <p className="text-[10px] text-zinc-600 mt-4 text-center">
            You can revoke this any time from your phone&apos;s app settings (Android) or by clearing site data (web).
          </p>
        </div>
      </div>
    );
  }, [pending, busy, error, accept, decline]);

  return { granted, ensureMediaPermission, MediaPermissionDialog };
}
