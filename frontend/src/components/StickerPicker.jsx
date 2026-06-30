import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import api from "../lib/api";

/**
 * Sticker / GIF picker. Two modes side-by-side:
 *
 *   1. EMOJI tab — always available. A curated set of 32 large reactions
 *      that ship in the bundle. Tap one → it's sent immediately as a DM
 *      body (single character) and the picker closes.
 *
 *   2. GIFs tab — only visible if the backend has TENOR_API_KEY set.
 *      Search Tenor v2 via our /api/stickers/tenor-search proxy (the
 *      key never leaves the server). Tap a result → sent as a single
 *      message with the GIF URL appended to media_paths so the existing
 *      image renderer picks it up inline.
 */
const EMOJI = [
  "😀","😂","🤣","😊","😍","🥰","😘","😎",
  "🤔","🤨","😐","🙄","😴","🤤","😭","🥺",
  "😡","🤬","🤯","🥶","🤢","🤮","😈","💀",
  "👍","👎","👏","🙌","💪","🤝","🫶","🔥",
  "❤️","💔","💯","✨","🎉","⭐","🌙","☀️",
];

export default function StickerPicker({ open, onClose, onSendEmoji, onSendGif }) {
  const [tab, setTab] = useState("emoji");
  const [tenorAvailable, setTenorAvailable] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // On open, ask the server whether Tenor is configured. The server
  // never reveals the key — just yes/no.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.get("/stickers/config")
      .then(({ data }) => { if (!cancelled) setTenorAvailable(!!data.tenor_enabled); })
      .catch(() => { if (!cancelled) setTenorAvailable(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!q.trim() || !tenorAvailable) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get(`/stickers/tenor-search?q=${encodeURIComponent(q)}`);
        setResults(data.results || []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, tenorAvailable]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/70"
      data-testid="sticker-picker"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-zinc-950 border-t border-zinc-800 rounded-t-3xl p-4 pb-6 max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1 text-[10px] uppercase tracking-[0.2em]">
            <button
              data-testid="sticker-tab-emoji"
              onClick={() => setTab("emoji")}
              className={`px-3 py-1.5 rounded-full ${tab === "emoji" ? "bg-[#FF5A00]/15 text-[#FF5A00]" : "text-zinc-500"}`}
            >
              Reactions
            </button>
            {tenorAvailable && (
              <button
                data-testid="sticker-tab-gifs"
                onClick={() => setTab("gifs")}
                className={`px-3 py-1.5 rounded-full ${tab === "gifs" ? "bg-[#FF5A00]/15 text-[#FF5A00]" : "text-zinc-500"}`}
              >
                GIFs
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-500 p-1" aria-label="Close" data-testid="sticker-close">
            <X size={18} />
          </button>
        </div>

        {tab === "emoji" && (
          <div className="grid grid-cols-8 gap-1 overflow-y-auto" data-testid="sticker-emoji-grid">
            {EMOJI.map((e) => (
              <button
                key={e}
                data-testid={`sticker-emoji-${e}`}
                onClick={() => { onSendEmoji(e); onClose(); }}
                className="aspect-square flex items-center justify-center text-2xl hover:bg-zinc-900 rounded-lg transition"
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {tab === "gifs" && tenorAvailable && (
          <>
            <div className="flex items-center gap-2 bg-zinc-900 rounded-full px-3 py-1.5 mb-3">
              <Search size={14} className="text-zinc-600" />
              <input
                data-testid="sticker-gif-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search Tenor…"
                className="flex-1 bg-transparent outline-none text-sm"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {searching && <div className="text-center text-zinc-500 text-xs py-4">Searching…</div>}
              {!searching && q && results.length === 0 && (
                <div className="text-center text-zinc-600 text-xs py-4">No results</div>
              )}
              {!q && (
                <div className="text-center text-zinc-600 text-xs py-4">Type to search GIFs</div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {results.map((g) => (
                  <button
                    key={g.id}
                    data-testid={`sticker-gif-${g.id}`}
                    onClick={() => { onSendGif(g.url); onClose(); }}
                    className="aspect-square overflow-hidden rounded-lg border border-zinc-800 hover:border-[#FF5A00] transition"
                  >
                    <img src={g.preview} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {!tenorAvailable && (
          <p className="text-[10px] text-zinc-600 mt-3 text-center">
            GIFs unlocked once a Tenor API key is set on the server.
          </p>
        )}
      </div>
    </div>
  );
}
