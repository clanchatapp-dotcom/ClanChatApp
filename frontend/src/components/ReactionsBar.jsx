import { useEffect, useRef, useState } from "react";
import api from "../lib/api";
import { SmilePlus } from "lucide-react";

/**
 * Reactions bar — one row that renders under any reactable item.
 *
 * Displays current reaction pills (emoji + count · highlighted if I picked
 * that one) and a "+" button that opens the 6-emoji picker.
 *
 * Props:
 *   kind: 'dm' | 'comment' | 'wall_post' | 'wall_reply' | 'board_message'
 *   targetId: string
 *   initial: optional `{ counts: {emoji: n}, mine: emoji|null }` — if the
 *            parent list already batch-loaded reactions, pass it to skip
 *            the fetch. Otherwise the bar lazy-loads on mount.
 *   compact: boolean — when true the "+" button only appears on hover,
 *            for dense lists like DM threads.
 */
const EMOJIS = ["❤️", "😂", "👍", "😮", "😢", "🔥"];

export default function ReactionsBar({ kind, targetId, initial = null, compact = false }) {
  const [state, setState] = useState(initial); // { counts, mine }
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const barRef = useRef(null);

  useEffect(() => {
    if (state) return;
    let cancel = false;
    api.get(`/reactions/${kind}/${targetId}`).then(r => {
      if (!cancel) setState(r.data);
    }).catch(() => {
      if (!cancel) setState({ counts: {}, mine: null });
    });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, targetId]);

  // Close picker when clicking outside.
  useEffect(() => {
    if (!picker) return;
    const onDown = (e) => {
      if (!barRef.current?.contains(e.target)) setPicker(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [picker]);

  const toggle = async (emoji) => {
    if (busy) return;
    setBusy(true);
    // Optimistic update.
    const prev = state || { counts: {}, mine: null };
    const nextCounts = { ...(prev.counts || {}) };
    const wasMine = prev.mine;
    if (wasMine) nextCounts[wasMine] = Math.max(0, (nextCounts[wasMine] || 1) - 1);
    let nextMine = emoji;
    if (wasMine === emoji) {
      nextMine = null;
    } else {
      nextCounts[emoji] = (nextCounts[emoji] || 0) + 1;
    }
    // strip zeroes
    Object.keys(nextCounts).forEach(k => { if (nextCounts[k] <= 0) delete nextCounts[k]; });
    setState({ counts: nextCounts, mine: nextMine });
    setPicker(false);
    try {
      await api.post("/reactions", { kind, target_id: targetId, emoji });
    } catch {
      setState(prev); // rollback
    } finally {
      setBusy(false);
    }
  };

  const entries = Object.entries(state?.counts || {}).filter(([, n]) => n > 0);
  const showPlusAlways = !compact || entries.length === 0;

  return (
    <div ref={barRef} className="relative inline-flex items-center gap-1.5 flex-wrap mt-1.5">
      {entries.map(([emoji, n]) => {
        const active = state?.mine === emoji;
        return (
          <button
            key={emoji}
            type="button"
            data-testid={`reaction-pill-${kind}-${targetId}-${emoji}`}
            onClick={() => toggle(emoji)}
            className={`inline-flex items-center gap-1 rounded-full text-xs px-2 py-0.5 border transition ${
              active
                ? "bg-[#FF5A00]/15 border-[#FF5A00]/60 text-white"
                : "bg-zinc-900/70 border-zinc-800 text-zinc-300 hover:border-zinc-600"
            }`}
          >
            <span>{emoji}</span>
            <span className="text-[10px] tabular-nums">{n}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-label="Add reaction"
        data-testid={`reaction-add-${kind}-${targetId}`}
        onClick={() => setPicker(p => !p)}
        className={`inline-flex items-center justify-center rounded-full text-xs w-6 h-6 border border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-[#FF5A00] hover:border-zinc-600 transition ${
          showPlusAlways ? "" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
        }`}
      >
        <SmilePlus size={12} />
      </button>
      {picker && (
        <div
          data-testid={`reaction-picker-${kind}-${targetId}`}
          className="absolute z-50 top-full left-0 mt-1 flex items-center gap-1 bg-black border border-zinc-800 rounded-full px-2 py-1.5 shadow-xl"
        >
          {EMOJIS.map(e => (
            <button
              key={e}
              type="button"
              data-testid={`reaction-emoji-${kind}-${targetId}-${e}`}
              onClick={() => toggle(e)}
              className={`text-lg leading-none hover:scale-125 transition-transform p-0.5 ${
                state?.mine === e ? "drop-shadow-[0_0_6px_#FF5A00]" : ""
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
