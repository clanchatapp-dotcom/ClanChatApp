import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import api, { fileUrl, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import PostCard from "../components/PostCard";
import { LinkIcon, ShoppingBag, MoreHorizontal, Settings as Cog, Camera, Pin, Layers } from "lucide-react";
import { toast } from "sonner";

const TABS = ["media", "wall", "audio"];

export default function Profile() {
  const { handle } = useParams();
  const { user: me, refresh } = useAuth();
  const nav = useNavigate();
  const isMyProfile = !handle || handle === me?.handle;

  const [data, setData] = useState(null); // { user, relation }
  const [tab, setTab] = useState("media");
  const [posts, setPosts] = useState([]);
  const [pinned, setPinned] = useState([]);
  const [wall, setWall] = useState([]);
  const [boards, setBoards] = useState([]);
  const [audio, setAudio] = useState([]);
  const [busy, setBusy] = useState(false);
  const [myCounts, setMyCounts] = useState({ followers: null, following: null });
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
    if (!isMyProfile) return;
    Promise.all([
      api.get("/users/me/followers").catch(() => ({ data: { count: 0 } })),
      api.get("/users/me/following").catch(() => ({ data: { count: 0 } })),
    ]).then(([f, fg]) => setMyCounts({ followers: f.data.count, following: fg.data.count }));
  }, [isMyProfile, me?.user_id]);

  const reloadPosts = async () => {
    if (!target) return;
    try {
      const [a, b] = await Promise.all([
        api.get(`/posts/by-user/${target.user_id}`),
        api.get(`/posts/pinned/${target.user_id}`),
      ]);
      setPosts(a.data.posts);
      setPinned(b.data.posts);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!target) return;
    reloadPosts();
    api.get(`/wall/${target.user_id}`).then(r => setWall(r.data.posts)).catch(() => setWall([]));
    api.get(`/boards/by-user/${target.user_id}`).then(r => setBoards(r.data.boards)).catch(() => setBoards([]));
    api.get(`/posts/audio/${target.user_id}`).then(r => setAudio(r.data.posts)).catch(() => setAudio([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {target.real_name && (
          <div className="text-xs text-zinc-400 mt-0.5" data-testid="profile-real-name">{target.real_name}</div>
        )}
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

        {isMyProfile && myCounts.followers !== null && (
          <div className="mt-5 flex items-center justify-center gap-6">
            <Link
              to="/me/followers"
              data-testid="my-followers-link"
              className="text-center hover:opacity-80 transition"
            >
              <div className="font-heading text-2xl leading-none">{myCounts.followers}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mt-1">Followers</div>
            </Link>
            <div className="w-px h-8 bg-zinc-900" />
            <Link
              to="/me/following"
              data-testid="my-following-link"
              className="text-center hover:opacity-80 transition"
            >
              <div className="font-heading text-2xl leading-none">{myCounts.following}</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mt-1">Following</div>
            </Link>
          </div>
        )}

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
      {/* Pinned ribbon — always visible above the tabs, max 3 (hard limit) */}
      {pinned.length > 0 && (
        <div className="mb-3" data-testid="pinned-ribbon">
          <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-[0.3em] text-zinc-500">
            <Pin size={11} /> Pinned
          </div>
          <div className="flex flex-col gap-3">
            {pinned.map(p => <PostCard key={p.post_id} post={p} onChange={reloadPosts} showPin={isMyProfile} currentUserId={me?.user_id} />)}
          </div>
        </div>
      )}

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

      {tab === "media" && (
        <div className="flex flex-col gap-3">
          {(() => {
            const mediaPosts = posts.filter(p => (p.media && p.media.length > 0) && !p.is_audio_track);
            if (mediaPosts.length === 0) return <div className="text-zinc-600 text-sm text-center py-8">No media posts yet.</div>;
            return mediaPosts.map(p => <PostCard key={p.post_id} post={p} onChange={reloadPosts} showPin={isMyProfile} currentUserId={me?.user_id} />);
          })()}
        </div>
      )}
      {tab === "audio" && (
        <div className="flex flex-col gap-3">
          {audio.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">No audio tracks.</div>}
          {audio.map(p => <PostCard key={p.post_id} post={p} onChange={reloadPosts} showPin={isMyProfile} currentUserId={me?.user_id} />)}
        </div>
      )}
      {tab === "wall" && (
        <WallTab ownerId={target.user_id} isMine={isMyProfile} wall={wall}
          textPosts={posts.filter(p => (!p.media || p.media.length === 0) && !p.is_audio_track)}
          boards={boards}
          reload={() => api.get(`/wall/${target.user_id}`).then(r => setWall(r.data.posts))}
          reloadBoards={() => api.get(`/boards/by-user/${target.user_id}`).then(r => setBoards(r.data.boards))}
          reloadPosts={reloadPosts} me={me} />
      )}
    </div>
  );
}

function WallTab({ ownerId, isMine, wall, textPosts, boards, reload, reloadBoards, reloadPosts, me }) {
  const [text, setText] = useState("");
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [boardTitle, setBoardTitle] = useState("");
  const [boardTier, setBoardTier] = useState("public");

  const post = async () => {
    if (!text.trim()) return;
    try {
      await api.post(`/wall/${ownerId}`, { content: text });
      setText(""); reload(); toast.success("Posted to wall");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const createBoard = async () => {
    if (!boardTitle.trim()) return;
    try {
      await api.post("/boards", { title: boardTitle, tier: boardTier, description: "" });
      setBoardTitle(""); setCreatingBoard(false); reloadBoards();
      toast.success("Board created");
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

      {/* Boards section — collapsed by default to keep wall clean */}
      <div className="border border-zinc-900 rounded-2xl">
        <button
          data-testid="boards-toggle"
          onClick={() => setBoardsOpen(!boardsOpen)}
          className="w-full flex items-center justify-between p-3 text-left"
        >
          <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            <Layers size={11} /> Discussion boards ({boards.length})
          </span>
          <span className="text-zinc-500 text-xs">{boardsOpen ? "Hide" : "Show"}</span>
        </button>

        {boardsOpen && (
          <div className="p-3 pt-0 flex flex-col gap-2">
            {isMine && !creatingBoard && (
              <button data-testid="new-board-btn" onClick={() => setCreatingBoard(true)} className="cc-btn-secondary text-xs py-1.5">+ New board</button>
            )}
            {isMine && creatingBoard && (
              <div className="border border-zinc-900 rounded-xl p-3 flex flex-col gap-2">
                <input data-testid="board-title" className="cc-input text-sm" placeholder="Board title" value={boardTitle} onChange={e => setBoardTitle(e.target.value)} />
                <div className="flex gap-1.5">
                  {["public", "followers", "inner"].map(t => (
                    <button key={t} onClick={() => setBoardTier(t)} data-testid={`board-tier-${t}`}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] uppercase tracking-wider border ${
                        boardTier === t ? "bg-[#FF5A00] text-black border-[#FF5A00]" : "border-zinc-800 text-zinc-500"
                      }`}>{t}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button data-testid="board-create" onClick={createBoard} className="cc-btn-primary text-xs py-1.5 flex-1">Create</button>
                  <button onClick={() => setCreatingBoard(false)} className="cc-btn-secondary text-xs py-1.5 flex-1">Cancel</button>
                </div>
              </div>
            )}
            {boards.length === 0 && <div className="text-zinc-600 text-xs text-center py-3">No boards yet.</div>}
            {boards.map(b => (
              <Link to={`/b/${b.board_id}`} key={b.board_id} data-testid={`board-${b.board_id}`}
                className="border border-zinc-900 rounded-xl p-2.5 hover:border-zinc-700 transition flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{b.title}</div>
                  {b.description && <div className="text-[11px] text-zinc-500 mt-0.5">{b.description}</div>}
                </div>
                <span className={`tier-pill-${b.tier} text-[10px] uppercase tracking-wider px-2 py-0.5 rounded`}>{b.tier}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {textPosts.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Words</div>
          {textPosts.map(p => <PostCard key={p.post_id} post={p} onChange={reloadPosts} showPin={isMine} currentUserId={me?.user_id} />)}
        </div>
      )}

      {wall.length > 0 && (
        <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mt-2">Wall notes</div>
      )}
      {wall.length === 0 && textPosts.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">Wall is quiet.</div>}
      {wall.map(w => (
        <div key={w.wall_post_id} className="border border-zinc-900 rounded-2xl p-4">
          <div className="text-xs text-zinc-500 mb-1">#{w.author?.handle}</div>
          <div className="text-sm whitespace-pre-wrap">{w.content}</div>
        </div>
      ))}
    </div>
  );
}
