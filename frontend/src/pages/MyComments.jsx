import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { MessageCircle, StickyNote, Layers, ArrowRight } from "lucide-react";
import Linkify from "../components/Linkify";

function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

const KIND_META = {
  comment: { label: "Comment", icon: MessageCircle, targetLabel: (t) => t.author_handle ? `on #${t.author_handle}'s post` : "on a post" },
  wall_reply: { label: "Wall reply", icon: StickyNote, targetLabel: (t) => t.owner_handle ? `on #${t.owner_handle}'s wall` : "on a wall" },
  board_message: { label: "Board", icon: Layers, targetLabel: (t) => `in "${t.board_title || "Board"}"` },
};

export default function MyComments() {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    api.get("/me/comments").then(r => setItems(r.data.items)).catch(() => setItems([]));
  }, []);

  const filtered = filter === "all" ? items : items?.filter(i => i.kind === filter);
  const counts = {
    all: items?.length ?? 0,
    comment: items?.filter(i => i.kind === "comment").length ?? 0,
    wall_reply: items?.filter(i => i.kind === "wall_reply").length ?? 0,
    board_message: items?.filter(i => i.kind === "board_message").length ?? 0,
  };

  // Group by day for nicer scanning.
  const grouped = {};
  (filtered || []).forEach(i => {
    const d = new Date(i.created_at);
    const key = d.toDateString();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(i);
  });

  const linkFor = (i) => {
    if (i.kind === "comment") return `/u/${i.target.author_handle}`;
    if (i.kind === "wall_reply") return `/u/${i.target.owner_handle}`;
    if (i.kind === "board_message") return `/board/${i.target.board_id}`;
    return "/me";
  };

  const stateFor = (i) => {
    if (i.kind === "comment") return { openPostId: i.target.post_id, openComments: true, openPostHasMedia: false };
    if (i.kind === "wall_reply") return { openWallPostId: i.target.wall_post_id, openWallReplies: true };
    return null;
  };

  return (
    <div className="px-5 pt-6 pb-32 max-w-3xl mx-auto">
      <header className="mb-5">
        <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Your history</div>
        <h1 className="font-heading text-3xl">My Comments</h1>
        <p className="text-sm text-zinc-500 mt-1">Every reply, comment and board message you&apos;ve written.</p>
      </header>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap mb-5 text-xs">
        {[
          ["all", "All"],
          ["comment", "Post comments"],
          ["wall_reply", "Wall replies"],
          ["board_message", "Boards"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-testid={`mycomments-filter-${key}`}
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1.5 border transition ${
              filter === key ? "bg-[#FF5A00] text-black border-[#FF5A00]" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            {label} <span className="opacity-60 ml-1">{counts[key]}</span>
          </button>
        ))}
      </div>

      {items === null && <div className="text-zinc-500 text-sm py-10 text-center">Loading…</div>}
      {items && filtered.length === 0 && (
        <div className="text-zinc-500 text-sm py-10 text-center">
          Nothing here yet. Start a conversation and it&apos;ll show up.
        </div>
      )}

      <div className="flex flex-col gap-6">
        {Object.entries(grouped).map(([day, dayItems]) => (
          <section key={day} data-testid={`mycomments-day-${day.replace(/\s+/g, "-")}`}>
            <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-2">{day}</div>
            <ul className="flex flex-col gap-2">
              {dayItems.map(i => {
                const meta = KIND_META[i.kind] || KIND_META.comment;
                const Icon = meta.icon;
                return (
                  <li
                    key={`${i.kind}-${i.id}`}
                    data-testid={`mycomments-item-${i.id}`}
                    className="border border-zinc-900 hover:border-zinc-700 transition rounded-2xl p-4 bg-zinc-950/40"
                  >
                    <div className="flex items-center gap-2 mb-1.5 text-[11px] text-zinc-500">
                      <Icon size={12} className="text-[#FF5A00]" />
                      <span className="uppercase tracking-[0.15em]">{meta.label}</span>
                      <span>·</span>
                      <span>{meta.targetLabel(i.target)}</span>
                      <span>·</span>
                      <span>{timeAgo(i.created_at)}</span>
                      {i.edited_at && <span className="uppercase text-[9px]">· edited</span>}
                    </div>
                    <div className="text-sm whitespace-pre-wrap break-words"><Linkify text={i.content} /></div>
                    {i.target.excerpt && (
                      <div className="mt-2 text-xs text-zinc-500 italic line-clamp-2 border-l-2 border-zinc-800 pl-2">
                        “{i.target.excerpt}”
                      </div>
                    )}
                    <Link
                      to={linkFor(i)}
                      state={stateFor(i)}
                      data-testid={`mycomments-goto-${i.id}`}
                      className="mt-3 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.15em] text-[#FF5A00] hover:text-white"
                    >
                      Go to post <ArrowRight size={11} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
