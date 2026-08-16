import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, ExternalLink, Copy, Check, Download, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";

// The APK URL is read from REACT_APP_APK_URL (set in frontend/.env). It can
// point at three sensible targets, in order of preference:
//   1. A GitHub Release asset URL (stable, works for both public and private
//      repos that have published a release):
//      https://github.com/<you>/<repo>/releases/latest/download/ClanChat-debug.apk
//   2. A nightly.link URL that proxies the most recent Actions artifact
//      (works on PUBLIC repos only, no GitHub login needed for the tester):
//      https://nightly.link/<you>/<repo>/workflows/android-apk/main/ClanChat-debug-apk.zip
//   3. The GitHub Actions run page itself (tester must be a repo collaborator
//      and logged into GitHub to download — least convenient but always works):
//      https://github.com/<you>/<repo>/actions/workflows/android-apk.yml
const FALLBACK_URL = "https://github.com/EnigmaticByThyme/clanchat/actions/workflows/android-apk.yml";
const APK_URL = process.env.REACT_APP_APK_URL || FALLBACK_URL;

export default function Install() {
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // PWA install prompt: browsers fire `beforeinstallprompt` when the site
  // meets the install-eligibility bar (HTTPS + manifest + registered SW).
  // We stash the event so a user click can call prompt() — spec forbids
  // calling it without a user gesture.
  const [pwaPrompt, setPwaPrompt] = useState(null);
  const [pwaInstalled, setPwaInstalled] = useState(false);

  useEffect(() => {
    setIsMobile(/android|iphone|ipad|ipod/i.test(navigator.userAgent));
    // If the app is already running as an installed PWA there's nothing
    // to install — reflect that in the UI.
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    setPwaInstalled(isStandalone);

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setPwaPrompt(e);
    };
    const onInstalled = () => { setPwaInstalled(true); setPwaPrompt(null); };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const installPwa = async () => {
    if (!pwaPrompt) return;
    try {
      pwaPrompt.prompt();
      const choice = await pwaPrompt.userChoice;
      if (choice?.outcome === "accepted") {
        toast.success("Installing ClanChat…");
      }
    } catch (e) { toast.error("Install prompt failed — try from the browser menu."); }
    setPwaPrompt(null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(APK_URL);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error("Couldn't copy — long-press the link below to copy manually."); }
  };

  return (
    <div className="px-5 pt-8 pb-24 max-w-md mx-auto">
      <header className="mb-6 text-center">
        <div className="text-[10px] uppercase tracking-[0.35em] text-zinc-500">ClanChat</div>
        <h1 className="font-heading text-3xl mt-2 leading-tight">Install on Android</h1>
        <p className="text-sm text-zinc-400 mt-3 leading-relaxed">
          Scan the code on your phone, or tap the link if you&apos;re already on mobile.
        </p>
      </header>

      <div className="bg-white p-6 rounded-3xl flex items-center justify-center" data-testid="install-qr">
        <QRCodeSVG
          value={APK_URL}
          size={240}
          bgColor="#FFFFFF"
          fgColor="#000000"
          level="M"
          includeMargin={false}
          imageSettings={{
            src: "/brand/icon-192.png",
            height: 44,
            width: 44,
            excavate: true,
          }}
        />
      </div>

      <div className="mt-5 flex gap-2">
        <a
          href={APK_URL}
          target="_blank"
          rel="noreferrer"
          data-testid="install-open-link"
          className="cc-btn-primary flex-1 inline-flex items-center justify-center gap-2 text-sm py-3"
        >
          <Smartphone size={14} /> {isMobile ? "Open on this device" : "Open download page"}
          <ExternalLink size={12} />
        </a>
        <button
          onClick={copy}
          data-testid="install-copy"
          className="cc-btn-secondary text-sm py-3 px-4 inline-flex items-center gap-2"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      <div className="mt-3 text-[11px] text-zinc-600 break-all border border-zinc-900 rounded-xl p-3" data-testid="install-url-text">
        {APK_URL}
      </div>

      <section className="mt-8 space-y-3">
        <h2 className="font-heading text-lg">How to install</h2>
        <ol className="text-sm text-zinc-400 space-y-2 leading-relaxed list-decimal pl-5">
          <li>Open the link above on the Android phone (Chrome works fine).</li>
          <li>Download the <code className="text-[#FF5A00]">ClanChat-debug.apk</code> file from the latest green build.</li>
          <li>Tap the downloaded file. Android will ask &quot;Allow from this source?&quot; → enable it.</li>
          <li>Tap <strong>Install</strong>. ClanChat lands on the home screen with the shield icon.</li>
        </ol>
      </section>

      {/* PWA install — surfaced separately from the APK path. Works on
          desktop Chrome/Edge, Android Chrome, and iOS Safari (via Add to
          Home Screen from the share sheet — no native prompt on iOS). */}
      <section className="mt-8 border-t border-zinc-900 pt-6">
        <div className="text-[10px] uppercase tracking-[0.35em] text-zinc-500 mb-2">Or install the web app</div>
        <h2 className="font-heading text-lg mb-2">Add ClanChat to your home screen</h2>
        <p className="text-sm text-zinc-500 leading-relaxed">
          Works on desktop, iPhone, and any Android browser. No app store required, no permissions to approve — just a shortcut that opens like a real app.
        </p>
        {pwaInstalled ? (
          <div className="mt-3 border border-emerald-500/30 bg-emerald-500/5 text-emerald-200 rounded-xl p-3 text-sm inline-flex items-center gap-2" data-testid="pwa-installed">
            <Check size={14} /> Already installed on this device.
          </div>
        ) : pwaPrompt ? (
          <button
            data-testid="pwa-install-btn"
            onClick={installPwa}
            className="cc-btn-primary mt-3 text-sm py-3 px-5 inline-flex items-center gap-2"
          >
            <Download size={14} /> Install ClanChat web app
          </button>
        ) : (
          <div className="mt-3 border border-zinc-900 rounded-xl p-3 text-xs text-zinc-500 leading-relaxed" data-testid="pwa-instructions">
            <div className="flex items-center gap-2 mb-2 text-zinc-300">
              <MonitorSmartphone size={13} /> How to install manually:
            </div>
            <div className="space-y-1.5">
              <div><strong className="text-zinc-400">Chrome / Edge (desktop):</strong> click the install icon in the address bar, or menu → &ldquo;Install ClanChat&rdquo;.</div>
              <div><strong className="text-zinc-400">Safari (iPhone/iPad):</strong> Share button → &ldquo;Add to Home Screen&rdquo;.</div>
              <div><strong className="text-zinc-400">Android Chrome:</strong> menu → &ldquo;Install app&rdquo;. Prompt should appear automatically after a few visits.</div>
            </div>
          </div>
        )}
      </section>

      <p className="text-[10px] text-zinc-700 mt-8 leading-relaxed text-center">
        Debug-signed build for testing only. Not on the Play Store yet. Updates land every time the dev pushes a new build — re-download to get the latest.
      </p>
    </div>
  );
}
