import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import api, { fileUrl, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import PostCard from "../components/PostCard";
import { LinkIcon, ShoppingBag, MoreHorizontal, Settings as Cog, Camera } from "lucide-react";
import { toast } from "sonner";

const TABS = ["feed", "wall", "boards", "pinned"];

export default function Profile() {
  const { handle } = useParams();
  const { user: me, refresh } = useAuth();
  const nav = useNavigate();
  const isMyProfile = !handle || handle === me?.handle;

  const [data, setData] = useState(null); // { user, relation }
  const [tab, setTab] = useState("feed");
  const [posts, setPosts] = useState([]);
  const [pinned, setPinned] = useState([]);
  const [wall, setWall] = useState([]);
  const [boards, setBoards] = useState([]);
  const [busy, setBusy] = useState(false);
  const avatarRef = useRef(null);

  const target = isMyProfile ? me : data?.user;

  const load = async () => {
    if (isMyProfile) {
      setData({ user: me, relation: { self: true, follows: false, inner: false } });
    } else {
      try {
        const { data } = await api.get(`/users/by-handle/${handle}`);
        setData(data);
      } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); nav("/feed"); return; }
    }
  };
  useEffect(() => { setData(null); load(); }, [handle, me?.user_id]);

  useEffect(() => {
    if (!target) return;
    api.get(`/posts/by-user/${target.user_id}`).then(r => setPosts(r.data.posts)).catch(() => setPosts([]));
    api.get(`/posts/pinned/${target.user_id}`).then(r => setPinned(r.data.posts)).catch(() => setPinned([]));
    api.get(`/wall/${target.user_id}`).then(r => setWall(r.data.posts)).catch(() => setWall([]));
    api.get(`/boards/by-user/${target.user_id}`).then(r => setBoards(r.data.boards)).catch(() => setBoards([]));
  }, [target?.user_id, tab]);

  if (!data || !target) return <div className="p-10 text-zinc-500 text-sm">Loading…</div>;

  const doFollow = async () => {
    setBusy(true);
    try {
      const { data: r } = await api.post(`/follow/${target.user_id}`);
      toast.success(r.status === "pending" ? "Request sent" : "Following");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const doUnfollow = async () => {
    await api.delete(`/follow/${target.user_id}`);
    toast.success("Unfollowed");
    load();
  };

  const onAvatar = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const form = new FormData();
    form.append("file", f);
    try {
      const { data: up } = await api.post("/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
      await api.patch("/users/me", { avatar_path: up.path });
      toast.success("Avatar updated");
      refresh();
    } catch (e2) { toast.error(formatApiError(e2.response?.data?.detail)); }
  };

  return (
    <div className="px-5 pt-6">
      <header className="flex justify-between items-start mb-4">
        <Link to="/feed" className="text-zinc-500 text-sm">← Feed</Link>
        {isMyProfile ? (
          <Link to="/settings" className="text-zinc-400 p-2" data-testid="profile-settings"><Cog size={18} /></Link>
        ) : (
          <button className="text-zinc-400 p-2"><MoreHorizontal size={18} /></button>
        )}
      </header>

      <div className="flex flex-col items-center text-center pb-5 border-b border-zinc-900">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center">
            {target.avatar_path ? (
              <img src={fileUrl(target.avatar_path)} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="font-heading text-3xl text-zinc-400">{target.handle[0].toUpperCase()}</span>
            )}
          </div>
          {isMyProfile && (
            <>
              <button onClick={() => avatarRef.current?.click()} data-testid="avatar-edit-btn"
                className="absolute bottom-0 right-0 bg-[#FF5A00] text-black rounded-full p-2">
                <Camera size={14} />
              </button>
              <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={onAvatar} />
            </>
          )}
        </div>
        <h2 className="font-heading text-2xl mt-3" data-testid="profile-handle">#{target.handle}</h2>
        <div className="text-sm text-zinc-500 mt-1">{target.display_name}</div>
        {target.bio && <p className="text-sm mt-3 text-zinc-300 max-w-xs leading-relaxed">{target.bio}</p>}

        {target.links?.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center mt-3">
            {target.links.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-[#FF5A00] inline-flex items-center gap-1 hover:underline">
                <LinkIcon size={12} /> {l.label}
              </a>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
          <span className="inline-flex items-center gap-1"><ShoppingBag size={11} /> Shop · coming soon</span>
        </div>

        <div className="mt-5 flex gap-2">
          {!isMyProfile && (
            <>
              {data.relation.follows ? (
                <button onClick={doUnfollow} data-testid="unfollow-btn" className="cc-btn-secondary py-2 px-5 text-sm">Following</button>
              ) : data.relation.follow_pending ? (
                <button disabled className="cc-btn-secondary py-2 px-5 text-sm">Requested</button>
              ) : (
                <button onClick={doFollow} disabled={busy} data-testid="follow-btn" className="cc-btn-primary py-2 px-5 text-sm">Follow</button>
              )}
              <Link to={`/m/${target.user_id}`} className="cc-btn-secondary py-2 px-5 text-sm" data-testid="message-btn">Message</Link>
            </>
          )}
          {isMyProfile && (
            <Link to="/edit-profile" data-testid="edit-profile-btn" className="cc-btn-secondary py-2 px-5 text-sm">Edit profile</Link>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mt-4 mb-4 border-b border-zinc-900 no-scrollbar overflow-x-auto">
        {TABS.map(t => (
          <button key={t} data-testid={`tab-${t}`} onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs uppercase tracking-[0.2em] border-b-2 transition ${
              tab === t ? "border-[#FF5A00] text-[#FF5A00]" : "border-transparent text-zinc-500"
            }`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "feed" && (
        <div className="flex flex-col gap-3">
          {posts.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">No posts.</div>}
          {posts.map(p => <PostCard key={p.post_id} post={p} onChange={load} showPin={isMyProfile} />)}
        </div>
      )}
      {tab === "pinned" && (
        <div className="flex flex-col gap-3">
          {pinned.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">Up to 3 pinned posts.</div>}
          {pinned.map(p => <PostCard key={p.post_id} post={p} onChange={load} showPin={isMyProfile} />)}
        </div>
      )}
      {tab === "wall" && (
        <WallTab ownerId={target.user_id} isMine={isMyProfile} wall={wall} reload={() => api.get(`/wall/${target.user_id}`).then(r => setWall(r.data.posts))} />
      )}
      {tab === "boards" && (
        <BoardsTab ownerId={target.user_id} isMine={isMyProfile} boards={boards} reload={() => api.get(`/boards/by-user/${target.user_id}`).then(r => setBoards(r.data.boards))} />
      )}
    </div>
  );
}

function WallTab({ ownerId, isMine, wall, reload }) {
  const [text, setText] = useState("");
  const post = async () => {
    if (!text.trim()) return;
    try {
      await api.post(`/wall/${ownerId}`, { content: text });
      setText(""); reload(); toast.success("Posted to wall");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="border border-zinc-900 rounded-2xl p-3">
        <textarea data-testid="wall-input" value={text} onChange={e => setText(e.target.value)}
          placeholder={isMine ? "Post to your wall…" : "Write on wall…"}
          className="bg-transparent w-full outline-none text-sm min-h-[60px]" maxLength={2000} />
        <div className="flex justify-end">
          <button data-testid="wall-submit" onClick={post} className="cc-btn-primary py-1 px-4 text-xs">Post</button>
        </div>
      </div>
      {wall.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">Wall is quiet.</div>}
      {wall.map(w => (
        <div key={w.wall_post_id} className="border border-zinc-900 rounded-2xl p-4">
          <div className="text-xs text-zinc-500 mb-1">#{w.author?.handle}</div>
          <div className="text-sm whitespace-pre-wrap">{w.content}</div>
        </div>
      ))}
    </div>
  );
}

function BoardsTab({ ownerId, isMine, boards, reload }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [tier, setTier] = useState("public");
  const create = async () => {
    if (!title.trim()) return;
    try {
      await api.post("/boards", { title, tier, description: "" });
      setTitle(""); setCreating(false); reload();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  return (
    <div className="flex flex-col gap-2">
      {isMine && (
        <>
          {!creating ? (
            <button data-testid="new-board-btn" onClick={() => setCreating(true)} className="cc-btn-secondary text-sm py-2">+ New board</button>
          ) : (
            <div className="border border-zinc-900 rounded-2xl p-3 flex flex-col gap-2">
              <input data-testid="board-title" className="cc-input" placeholder="Board title" value={title} onChange={e => setTitle(e.target.value)} />
              <div className="flex gap-2">
                {["public", "followers", "inner"].map(t => (
                  <button key={t} onClick={() => setTier(t)} data-testid={`board-tier-${t}`}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] uppercase tracking-wider border ${
                      tier === t ? "bg-[#FF5A00] text-black border-[#FF5A00]" : "border-zinc-800 text-zinc-400"
                    }`}>{t}</button>
                ))}
              </div>
              <div className="flex gap-2">
                <button data-testid="board-create" onClick={create} className="cc-btn-primary text-xs py-2 flex-1">Create</button>
                <button onClick={() => setCreating(false)} className="cc-btn-secondary text-xs py-2 flex-1">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
      {boards.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">No boards.</div>}
      {boards.map(b => (
        <Link to={`/b/${b.board_id}`} key={b.board_id} data-testid={`board-${b.board_id}`}
          className="border border-zinc-900 rounded-2xl p-4 hover:border-zinc-700 transition">
          <div className="flex items-center justify-between">
            <div className="font-medium">{b.title}</div>
            <span className={`tier-pill-${b.tier} text-[10px] uppercase tracking-wider px-2 py-1 rounded`}>{b.tier}</span>
          </div>
          {b.description && <div className="text-xs text-zinc-500 mt-1">{b.description}</div>}
        </Link>
      ))}
    </div>
  );
}
