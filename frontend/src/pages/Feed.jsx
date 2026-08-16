import { useEffect, useState, useRef } from "react";
import api, { fileUrl } from "../lib/api";
import PostCard from "../components/PostCard";
import Lightbox from "../components/Lightbox";
import { Link } from "react-router-dom";
import { Plus, Settings, Bell, Globe2, Users, ChevronDown } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const SCOPE_LABELS = {
  general: { label: "General", icon: Globe2, blurb: "Everyone you can see" },
  followers: { label: "Followers", icon: Users, blurb: "People you follow" },
};

export default function Feed() {
  const [mode, setMode] = useState("words"); // words | gallery
  const [scope, setScope] = useState("general"); // general | followers
  const [scopeOpen, setScopeOpen] = useState(false);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ follow_requests: 0, inner_invites: 0, unread_dms: 0 });
  // Gallery lightbox state — flat list of every image in the feed keyed by
  // post so we can render the author footer inside the lightbox.
  const [lightbox, setLightbox] = useState(null); // { items: string[], meta: [], index: number }
  const scopeMenuRef = useRef(null);
  const { user } = useAuth();

  const load = async (nextScope = scope) => {
    setLoading(true);
    try {
      const { data } = await api.get("/posts/feed", { params: { scope: nextScope } });
      setPosts(data.posts);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load(scope);
    api.get("/notifications/counts").then(r => setCounts(r.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // Close the scope dropdown on outside click.
  useEffect(() => {
    if (!scopeOpen) return;
    const onDown = (e) => {
      if (!scopeMenuRef.current?.contains(e.target)) setScopeOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [scopeOpen]);

  // Words = text-only posts (no media attached). Gallery = posts with media.
  // Audio tracks are treated as media for the purpose of the toggle.
  const filtered = mode === "gallery"
    ? posts.filter(p => p.media?.length > 0)
    : posts.filter(p => !p.media || p.media.length === 0);
  const notif = counts.follow_requests + counts.inner_invites;

  // Build the flat gallery grid so the lightbox can page through EVERY
  // image in the feed (skipping video for the fullscreen viewer).
  const galleryFlat = mode === "gallery"
    ? filtered.flatMap(p => (p.media || []).map((m) => ({
        path: m,
        author: p.author,
        postId: p.post_id,
        isVideo: /\.(mp4|webm|mov)$/i.test(m),
      })))
    : [];
  const galleryImages = galleryFlat.filter(g => !g.isVideo);

  const openGallery = (path) => {
    // Locate the tapped path in the images-only slice.
    const items = galleryImages.map(g => g.path);
    const meta = galleryImages.map(g => g.author);
    const startIdx = Math.max(0, items.indexOf(path));
    setLightbox({ items, meta, index: startIdx });
  };

  const ScopeIcon = SCOPE_LABELS[scope].icon;

  return (
    <div className="px-5 pt-6">
      {/* Top scope selector — "General ▾" opens a menu with General/Followers. */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="relative" ref={scopeMenuRef}>
          <button
            type="button"
            data-testid="feed-scope-btn"
            onClick={() => setScopeOpen(o => !o)}
            className="inline-flex items-center gap-2 bg-zinc-950 border border-zinc-900 hover:border-zinc-700 transition rounded-full px-3.5 py-2"
          >
            <ScopeIcon size={14} className="text-[#FF5A00]" />
            <span className="text-sm font-medium">{SCOPE_LABELS[scope].label}</span>
            <ChevronDown size={13} className={`text-zinc-500 transition-transform ${scopeOpen ? "rotate-180" : ""}`} />
          </button>
          {scopeOpen && (
            <div
              data-testid="feed-scope-menu"
              className="absolute left-0 top-full mt-1.5 min-w-[220px] bg-black border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-40"
            >
              {Object.entries(SCOPE_LABELS).map(([key, { label, icon: Icon, blurb }]) => {
                const active = key === scope;
                return (
                  <button
                    key={key}
                    type="button"
                    data-testid={`feed-scope-option-${key}`}
                    onClick={() => { setScope(key); setScopeOpen(false); }}
                    className={`w-full text-left flex items-start gap-3 px-3 py-2.5 transition ${
                      active ? "bg-[#FF5A00]/10" : "hover:bg-zinc-900"
                    }`}
                  >
                    <Icon size={15} className={active ? "text-[#FF5A00] mt-0.5" : "text-zinc-500 mt-0.5"} />
                    <div className="min-w-0">
                      <div className={`text-sm ${active ? "text-[#FF5A00] font-medium" : "text-zinc-200"}`}>{label}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{blurb}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/notifications" data-testid="notif-link" className="relative w-10 h-10 rounded-full border border-zinc-900 flex items-center justify-center hover:bg-zinc-900">
            <Bell size={18} />
            {notif > 0 && <span className="absolute -top-1 -right-1 bg-[#FF5A00] text-black text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{notif}</span>}
          </Link>
          <Link to="/settings" data-testid="settings-link" className="w-10 h-10 rounded-full border border-zinc-900 flex items-center justify-center hover:bg-zinc-900">
            <Settings size={18} />
          </Link>
        </div>
      </div>

      <header className="mb-5">
        <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Clubhouse</div>
        <h1 className="font-heading text-3xl">My Feed</h1>
      </header>

      <div className="flex items-center justify-between mb-5">
        <div className="inline-flex bg-zinc-950 border border-zinc-900 rounded-full p-1">
          <button data-testid="feed-toggle-words" onClick={() => setMode("words")}
            className={`px-4 py-1.5 rounded-full text-xs uppercase tracking-[0.2em] transition ${mode === "words" ? "bg-[#FF5A00] text-black" : "text-zinc-400"}`}>
            Words
          </button>
          <button data-testid="feed-toggle-gallery" onClick={() => setMode("gallery")}
            className={`px-4 py-1.5 rounded-full text-xs uppercase tracking-[0.2em] transition ${mode === "gallery" ? "bg-[#FF5A00] text-black" : "text-zinc-400"}`}>
            Gallery
          </button>
        </div>
        <Link to="/compose" data-testid="compose-link" className="cc-btn-primary inline-flex items-center gap-2 py-2 px-4 text-sm">
          <Plus size={16} /> Post
        </Link>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-center py-20 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 px-6">
          <p className="text-zinc-400 text-lg">Quiet in here.</p>
          <p className="text-zinc-600 mt-2 text-sm">
            {scope === "followers"
              ? "Nobody you follow has posted recently. Try switching to General."
              : mode === "gallery" ? "No gallery posts in your feed yet." : "Be the first to post or follow some people."}
          </p>
        </div>
      ) : mode === "gallery" ? (
        <div className="grid grid-cols-2 gap-2">
          {galleryFlat.map((g, i) => (
            <button
              key={`${g.postId}-${i}`}
              type="button"
              data-testid={`gallery-thumb-${g.postId}-${i}`}
              onClick={() => !g.isVideo && openGallery(g.path)}
              className="aspect-square overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950 relative p-0 block cursor-zoom-in"
            >
              {g.isVideo ? (
                <video src={fileUrl(g.path)} className="w-full h-full object-cover" />
              ) : (
                <img src={fileUrl(g.path)} alt="" className="w-full h-full object-cover" />
              )}
              <div className="absolute bottom-2 left-2 text-[10px] uppercase tracking-[0.2em] bg-black/50 px-2 py-0.5 rounded pointer-events-none">
                #{g.author?.handle}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map(p => <PostCard key={p.post_id} post={p} onChange={() => load(scope)} showPin={p.author?.user_id === user?.user_id} currentUserId={user?.user_id} />)}
        </div>
      )}

      {lightbox && (
        <Lightbox
          items={lightbox.items}
          meta={lightbox.meta}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
