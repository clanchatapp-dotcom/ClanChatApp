import { useState, useCallback } from "react";
import { ImagePlus, ShieldCheck, X } from "lucide-react";

const STORAGE_KEY = "clanchat_media_permission";

/**
 * Web-first media-access consent gate.
 *
 *   const { ensureMediaPermission, MediaPermissionDialog } = useMediaPermission();
 *   const onAttachClick = async () => {
 *     if (!(await ensureMediaPermission())) return;
 *     fileRef.current?.click();
 *   };
 *
 *   // Inside JSX:
 *   <MediaPermissionDialog />
 *
 * On the WEB the file picker doesn't require an OS-level permission, but we
 * still ask the user once for in-app consent and remember the answer. That
 * way the experience is identical to native and the user knows why we're
 * about to open the picker. On the Android Capacitor APK the
 * READ_MEDIA_IMAGES / READ_MEDIA_VIDEO permissions in AndroidManifest.xml
 * also fire the OS-level prompt the first time a file is actually selected.
 */
export default function useMediaPermission() {
  const initial = (() => {
    try { return localStorage.getItem(STORAGE_KEY) === "granted"; }
    catch { return false; }
  })();
  const [granted, setGranted] = useState(initial);
  const [pending, setPending] = useState(null); // resolver fn while dialog is open

  const ensureMediaPermission = useCallback(() => {
    if (granted) return Promise.resolve(true);
    return new Promise((resolve) => setPending(() => resolve));
  }, [granted]);

  const accept = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, "granted"); } catch { /* ignore */ }
    setGranted(true);
    if (pending) { pending(true); setPending(null); }
  }, [pending]);

  const decline = useCallback(() => {
    if (pending) { pending(false); setPending(null); }
  }, [pending]);

  const MediaPermissionDialog = useCallback(() => {
    if (!pending) return null;
    return (
      <div
        className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm"
        data-testid="media-permission-dialog"
        onClick={decline}
      >
        <div
          className="relative w-full max-w-md mx-auto bg-zinc-950 border border-zinc-800 rounded-t-3xl sm:rounded-3xl p-6 pb-8 m-0 sm:m-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            data-testid="media-permission-close"
            onClick={decline}
            className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 p-1"
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

          <div className="flex gap-2 mt-7">
            <button
              data-testid="media-permission-decline"
              onClick={decline}
              className="cc-btn-secondary flex-1 text-sm py-2.5"
            >
              Not now
            </button>
            <button
              data-testid="media-permission-allow"
              onClick={accept}
              className="cc-btn-primary flex-1 text-sm py-2.5"
            >
              Allow
            </button>
          </div>

          <p className="text-[10px] text-zinc-600 mt-4 text-center">
            You can revoke this any time from your phone&apos;s app settings (Android) or by clearing site data (web).
          </p>
        </div>
      </div>
    );
  }, [pending, accept, decline]);

  return { granted, ensureMediaPermission, MediaPermissionDialog };
}
