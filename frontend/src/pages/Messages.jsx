import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import api, { fileUrl, formatApiError } from "../lib/api";
import { Send, Paperclip, X, Search, ShieldAlert, ShieldCheck, Phone, Video, Smile } from "lucide-react";
import { toast } from "sonner";
import useMediaPermission from "../hooks/useMediaPermission";

// Native screenshot-block bridge. On the Android Capacitor APK we set
// FLAG_SECURE on the window while a "no screenshots" thread is open. On
// web/iOS this is a no-op (no platform API exists to block screenshots).
async function setNativeScreenshotBlock(block) {
  try {
    const Cap = window.Capacitor;
    if (!Cap?.isNativePlatform?.()) return false;
    if (Cap.getPlatform?.() !== "android") return false;
    // Try the community privacy-screen plugin first (most ergonomic).
    if (Cap.Plugins?.PrivacyScreen?.enable && block) {
      await Cap.Plugins.PrivacyScreen.enable();
      return true;
    }
    if (Cap.Plugins?.PrivacyScreen?.disable && !block) {
      await Cap.Plugins.PrivacyScreen.disable();
      return true;
    }
    // Fallback: WindowSecure plugin if PrivacyScreen isn't installed.
    if (Cap.Plugins?.WindowSecure?.setSecure) {
      await Cap.Plugins.WindowSecure.setSecure({ secure: !!block });
      return true;
    }
  } catch (e) { console.warn("native screenshot block failed", e); }
  return false;
}

export function Messages() {
  const [threads, setThreads] = useState([]);
  useEffect(() => {
    api.get("/dms/threads").then(r => setThreads(r.data.threads)).catch(() => {});
  }, []);
  return (
    <div className="px-5 pt-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-heading text-3xl">Messages</h1>
        <Link to="/groups" data-testid="open-groups-link" className="cc-btn-secondary text-xs py-1.5 px-3">Groups</Link>
      </div>
      {threads.length === 0 && <div className="text-zinc-600 text-sm text-center py-10">No conversations yet.</div>}
      <div className="flex flex-col gap-1">
        {threads.map(t => {
          const isSelf = t.with.is_self;
          return (
            <Link to={`/m/${t.with.user_id}`} key={t.with.user_id}
              data-testid={isSelf ? "thread-self" : `thread-${t.with.handle}`}
              className={`flex items-center gap-3 p-3 rounded-2xl hover:bg-zinc-950 transition ${
                isSelf ? "border border-[#FF5A00]/20 bg-[#FF5A00]/[0.03]" : ""
              }`}>
              <div className={`w-12 h-12 rounded-full overflow-hidden flex items-center justify-center shrink-0 ${
                isSelf ? "bg-gradient-to-br from-[#FF5A00] to-[#A00B00]" : "bg-zinc-800"
              }`}>
                {isSelf ? (
                  <span className="font-heading text-black text-lg">★</span>
                ) : t.with.avatar_path ? (
                  <img src={fileUrl(t.with.avatar_path)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="font-heading text-zinc-400">{t.with.handle[0].toUpperCase()}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  {isSelf ? "Me, myself and I" : `#${t.with.handle}`}
                  {isSelf && <span className="text-[9px] uppercase tracking-[0.25em] text-[#FF5A00]">Saved</span>}
                </div>
                <div className="text-xs text-zinc-500 truncate">
                  {t.last ? t.last.content : (isSelf ? "Notes to self · photos · audio — all in one place." : "")}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function MessageThread() {
  const { userId } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingMedia, setPendingMedia] = useState([]); // [{path, kind, name}]
  const [query, setQuery] = useState("");
  const fileRef = useRef(null);
  const { ensureMediaPermission, MediaPermissionDialog } = useMediaPermission();

  const load = async () => {
    try {
      const { data } = await api.get(`/dms/with/${userId}`);
      setData(data);
      window.dispatchEvent(new Event("clanchat:notif-refresh"));
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, [userId]);

  // Activate native screenshot block when allowed===false. Cleared on unmount
  // OR when the user navigates to another thread that does allow screenshots.
  useEffect(() => {
    if (!data) return;
    // Self-DM is always treated as allowed (you can screenshot your own notes)
    const block = !data.screenshots_allowed && !data.with?.is_self;
    setNativeScreenshotBlock(block);
    return () => { setNativeScreenshotBlock(false); };
  }, [data?.screenshots_allowed, data?.with?.is_self, data]);

  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    // Re-enable screenshot block after the picker closes if this thread requires it.
    const needsBlock = data && !data.screenshots_allowed && !data.with?.is_self;
    if (needsBlock) setNativeScreenshotBlock(true);
    if (!files.length) return;
    const room = 4 - pendingMedia.length;
    if (room <= 0) { toast.error("Max 4 attachments per message"); return; }
    const queue = files.slice(0, room);
    setBusy(true);
    try {
      for (const f of queue) {
        const fd = new FormData();
        fd.append("file", f);
        const { data } = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
        const kind = f.type.startsWith("video/") ? "video" : f.type.startsWith("audio/") ? "audio" : "image";
        setPendingMedia((prev) => [...prev, { path: data.path, kind, name: f.name }]);
      }
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail) || "Upload failed"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const send = async (e) => {
    e?.preventDefault?.();
    if ((!text.trim() && pendingMedia.length === 0) || busy) return;
    setBusy(true);
    try {
      await api.post("/dms", {
        recipient_id: userId,
        content: text,
        media_paths: pendingMedia.map((m) => m.path),
      });
      setText(""); setPendingMedia([]);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  // Search filters by message content. Self-DM is the primary saved-vault
  // use case but the search applies to any thread.
  const visibleMessages = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.messages;
    return data.messages.filter((m) => (m.content || "").toLowerCase().includes(q));
  }, [data, query]);

  if (!data) return <div className="p-10 text-zinc-500 text-sm">Loading…</div>;

  return (
    <div className="px-5 pt-6 pb-40 flex flex-col min-h-screen">
      <header className="flex items-center gap-3 mb-4">
        <button onClick={() => nav(-1)} className="text-zinc-500 text-sm">← Back</button>
        {data.with?.is_self ? (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#FF5A00] to-[#A00B00] flex items-center justify-center">
              <span className="font-heading text-black">★</span>
            </div>
            <div>
              <div className="font-heading text-xl leading-none">Me, myself and I</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#FF5A00]">Saved · only you can see this</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <Link to={`/u/${data.with?.handle}`} className="font-heading text-2xl">#{data.with?.handle}</Link>
            <span
              data-testid="dm-encrypted-badge"
              className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded ml-auto"
              title="Messages are encrypted at rest with AES-256. ClanChat holds the keys — this is server-side encryption, not end-to-end."
            >
              <ShieldCheck size={9} /> Encrypted
            </span>
          </div>
        )}
      </header>

      {/* Screenshot policy banner — hidden on the self thread (no need). */}
      {!data.with?.is_self && (
        <div
          data-testid="dm-screenshot-banner"
          className={`mb-3 px-3 py-2 rounded-xl text-[11px] flex items-start gap-2 ${
            data.screenshots_allowed
              ? "border border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
              : "border border-amber-500/30 bg-amber-500/5 text-amber-200"
          }`}
        >
          {data.screenshots_allowed ? <ShieldCheck size={13} className="mt-0.5 shrink-0" /> : <ShieldAlert size={13} className="mt-0.5 shrink-0" />}
          <span>
            {data.screenshots_allowed
              ? <>Both of you allow screenshots in this thread.</>
              : <>
                  Screenshots blocked on the ClanChat Android app (one or both of you opted in to privacy).
                  On web &amp; iOS the platform can&apos;t actually prevent screenshots — assume any message could be captured.
                </>}
          </span>
        </div>
      )}

      {/* Search bar — shown on every thread, especially useful for self-DM */}
      <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-900 rounded-full px-3 py-1.5 mb-4">
        <Search size={14} className="text-zinc-600" />
        <input
          data-testid="dm-search"
          className="flex-1 bg-transparent outline-none text-sm"
          placeholder={data.with?.is_self ? "Search your notes…" : "Search this conversation…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            data-testid="dm-search-clear"
            className="text-zinc-500 hover:text-zinc-300"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {query && (
        <div className="text-[11px] text-zinc-500 mb-2" data-testid="dm-search-count">
          {visibleMessages.length} match{visibleMessages.length === 1 ? "" : "es"}
        </div>
      )}

      <div className="flex-1 flex flex-col gap-3">
        {visibleMessages.map((m) => {
          const outgoing = m.from_id !== userId;
          return (
            <div key={m.message_id} data-testid={`msg-${m.message_id}`}
              className={`max-w-[80%] rounded-2xl px-3 py-2 ${outgoing ? "bg-[#FF5A00] text-black self-end" : "bg-zinc-900 self-start"}`}>
              {m.media_paths?.length > 0 && (
                <div className={`grid gap-1 mb-1 ${m.media_paths.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {m.media_paths.map((p) => (
                    <DMMedia key={p} path={p} />
                  ))}
                </div>
              )}
              {m.content && (
                <div className="text-sm whitespace-pre-wrap break-words">{m.content}</div>
              )}
            </div>
          );
        })}
        {visibleMessages.length === 0 && (
          <div className="text-zinc-600 text-sm text-center py-10">
            {query ? "No matches." : data.with?.is_self ? "Drop a note to your future self." : "Say hi."}
          </div>
        )}
      </div>

      <form
        onSubmit={send}
        className="fixed left-1/2 -translate-x-1/2 w-full max-w-lg px-5 z-[55]"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {!data.can_send && (
          <div className="text-xs text-zinc-500 mb-2 text-center">{data.reason || "Cannot message this user"}</div>
        )}

        {pendingMedia.length > 0 && (
          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-2 mb-2 flex gap-1.5 overflow-x-auto">
            {pendingMedia.map((m, i) => (
              <div key={m.path} className="relative shrink-0" data-testid={`pending-media-${i}`}>
                {m.kind === "image" ? (
                  <img src={fileUrl(m.path)} alt="" className="w-14 h-14 object-cover rounded-lg" />
                ) : (
                  <div className="w-14 h-14 bg-zinc-900 rounded-lg flex items-center justify-center text-[10px] uppercase text-zinc-400 px-1 text-center">{m.kind}</div>
                )}
                <button
                  type="button"
                  onClick={() => setPendingMedia((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute -top-1 -right-1 bg-black border border-zinc-700 rounded-full w-4 h-4 flex items-center justify-center"
                  data-testid={`pending-media-remove-${i}`}
                >
                  <X size={10} className="text-zinc-300" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-900 rounded-full p-1.5">
          <button
            type="button"
            data-testid="dm-attach"
            onClick={async () => {
              if (!(await ensureMediaPermission())) return;
              // Temporarily lift FLAG_SECURE so the Android file picker can render.
              // The onPickFiles handler re-enables the block when needed.
              await setNativeScreenshotBlock(false);
              fileRef.current?.click();
            }}
            disabled={!data.can_send || pendingMedia.length >= 4 || busy}
            className="p-2 text-zinc-400 hover:text-[#FF5A00] disabled:opacity-40"
            aria-label="Attach"
          >
            <Paperclip size={16} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={onPickFiles}
            data-testid="dm-file-input"
          />
          <button
            type="button"
            data-testid="dm-call-audio"
            onClick={() => toast.info("Voice calls — coming in the next build")}
            disabled={!data.can_send || busy}
            className="p-2 text-zinc-500 hover:text-[#FF5A00] disabled:opacity-40"
            aria-label="Voice call (coming soon)"
            title="Voice call — coming in the next build"
          >
            <Phone size={16} />
          </button>
          <button
            type="button"
            data-testid="dm-call-video"
            onClick={() => toast.info("Video calls — coming in the next build")}
            disabled={!data.can_send || busy}
            className="p-2 text-zinc-500 hover:text-[#FF5A00] disabled:opacity-40"
            aria-label="Video call (coming soon)"
            title="Video call — coming in the next build"
          >
            <Video size={16} />
          </button>
          <button
            type="button"
            data-testid="dm-stickers"
            onClick={() => toast.info("Stickers & GIFs — coming in the next build")}
            disabled={!data.can_send || busy}
            className="p-2 text-zinc-500 hover:text-[#FF5A00] disabled:opacity-40"
            aria-label="Stickers (coming soon)"
            title="Stickers & GIFs — coming in the next build"
          >
            <Smile size={16} />
          </button>
          <input
            data-testid="dm-input"
            className="flex-1 bg-transparent px-1 py-1 outline-none text-sm"
            placeholder={data.can_send ? "Message…" : "DM not allowed"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!data.can_send}
          />
          <button
            data-testid="dm-send"
            className="bg-[#FF5A00] disabled:bg-zinc-800 text-black p-2 rounded-full"
            disabled={!data.can_send || busy || (!text.trim() && pendingMedia.length === 0)}
          >
            <Send size={16} />
          </button>
        </div>
      </form>
      <MediaPermissionDialog />
    </div>
  );
}

// Inline media renderer for DMs. Images load lazily; video/audio get native controls.
function DMMedia({ path }) {
  const url = fileUrl(path);
  const lower = path.toLowerCase();
  const isVideo = lower.match(/\.(mp4|mov|webm|m4v)(\?|$)/);
  const isAudio = lower.match(/\.(mp3|wav|m4a|ogg|aac|flac)(\?|$)/);
  if (isVideo) {
    return <video src={url} controls preload="metadata" className="rounded-lg max-h-72 w-full bg-black" data-testid="dm-media-video" />;
  }
  if (isAudio) {
    return <audio src={url} controls preload="metadata" className="w-full" data-testid="dm-media-audio" />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="" loading="lazy" data-testid="dm-media-image" className="rounded-lg max-h-72 w-full object-cover" />
    </a>
  );
}
