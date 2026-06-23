import { useEffect, useState } from "react";
import api from "../lib/api";
import PostCard from "../components/PostCard";
import { Link } from "react-router-dom";
import { Plus, Settings, Bell } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Feed() {
  const [mode, setMode] = useState("words"); // words | gallery
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ follow_requests: 0, inner_invites: 0, unread_dms: 0 });
  const { user } = useAuth();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/posts/feed");
      setPosts(data.posts);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); api.get("/notifications/counts").then(r => setCounts(r.data)).catch(() => {}); }, []);

  const filtered = mode === "gallery" ? posts.filter(p => p.media?.length > 0) : posts;
  const notif = counts.follow_requests + counts.inner_invites;

  return (
    <div className="px-5 pt-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Clubhouse</div>
          <h1 className="font-heading text-3xl">Feed</h1>
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
            {mode === "gallery" ? "No gallery posts in your feed yet." : "Be the first to post or follow some people."}
          </p>
        </div>
      ) : mode === "gallery" ? (
        <div className="grid grid-cols-2 gap-2">
          {filtered.map(p => p.media.map((m, i) => (
            <Link key={`${p.post_id}-${i}`} to={`/u/${p.author?.handle}`}
              className="aspect-square overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950 relative">
              {/\.(mp4|webm|mov)$/i.test(m) ? (
                <video src={`${process.env.REACT_APP_BACKEND_URL}/api/files/${m}`} className="w-full h-full object-cover" />
              ) : (
                <img src={`${process.env.REACT_APP_BACKEND_URL}/api/files/${m}`} alt="" className="w-full h-full object-cover" />
              )}
              <div className="absolute bottom-2 left-2 text-[10px] uppercase tracking-[0.2em] bg-black/50 px-2 py-0.5 rounded">#{p.author?.handle}</div>
            </Link>
          )))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map(p => <PostCard key={p.post_id} post={p} onChange={load} showPin={p.author?.user_id === user?.user_id} currentUserId={user?.user_id} />)}
        </div>
      )}
    </div>
  );
}
