import { useEffect, useRef, useState } from "react";
import { X, Search, Loader2 } from "lucide-react";

/**
 * GiphyPicker — inline sticker + GIF picker.
 *
 * Frontend-only per Giphy's TOS (they explicitly do not want the key
 * proxied through a backend). Reads the key from the standard React
 * env var so the same code works in web + Capacitor builds.
 *
 * Props:
 *   onSelect(payload)   — called with { id, mode, sourceUrl, previewUrl,
 *                                       sendUrl, attribution } when the
 *                                       user taps a tile.
 *   onClose()            — call when the user cancels the picker.
 *
 * SFW-only: `rating=g` is hardcoded and cannot be overridden.
 */
const GIPHY_KEY = process.env.REACT_APP_GIPHY_API_KEY || "";
const BASE = "https://api.giphy.com/v1";
const RATING = "g"; // SFW hardcoded — do NOT change without spec update

async function fetchGiphy(mode, query, offset = 0) {
  if (!GIPHY_KEY) throw new Error("giphy-key-missing");
  const kind = mode === "gif" ? "gifs" : "stickers";
  const endpoint = query.trim() ? `${kind}/search` : `${kind}/trending`;
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set("api_key", GIPHY_KEY);
  url.searchParams.set("rating", RATING);
  url.searchParams.set("limit", "24");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set(
    "fields",
    "id,url,title,username,alt_text,images.fixed_height_small,images.fixed_height,images.original"
  );
  if (query.trim()) url.searchParams.set("q", query.trim());
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`giphy-${res.status}`);
  const json = await res.json();
  return json.data || [];
}

function pickThumb(item) {
  const im = item.images || {};
  return (
    im.fixed_height_small?.webp ||
    im.fixed_height_small?.url ||
    im.fixed_height?.webp ||
    im.fixed_height?.url ||
    im.original?.url ||
    ""
  );
}
function pickSend(item, mode) {
  const im = item.images || {};
  if (mode === "sticker") {
    return im.original?.webp || im.original?.url || "";
  }
  return im.original?.url || im.original?.webp || "";
}

export default function GiphyPicker({ onSelect, onClose }) {
  const [mode, setMode] = useState("gif");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (!GIPHY_KEY) { setErr("giphy-key-missing"); return; }
    let alive = true;
    // Debounce so we don't burn quota while the user is still typing.
    const t = setTimeout(async () => {
      setLoading(true); setErr(null);
      try {
        const data = await fetchGiphy(mode, query);
        if (alive) setItems(data);
      } catch (e) {
        if (alive) { setItems([]); setErr(e.message || "network"); }
      } finally { if (alive) setLoading(false); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [mode, query]);

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-2 bg-black border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-40"
      data-testid="giphy-picker"
    >
      {/* Header — tab toggle + close */}
      <div className="flex items-center gap-1 p-2 border-b border-zinc-900">
        <button
          data-testid="giphy-tab-gif"
          onClick={() => setMode("gif")}
          className={`text-xs py-1 px-3 rounded-full transition ${mode === "gif" ? "bg-[#FF5A00] text-black" : "text-zinc-400 hover:text-zinc-200"}`}
        >GIF</button>
        <button
          data-testid="giphy-tab-sticker"
          onClick={() => setMode("sticker")}
          className={`text-xs py-1 px-3 rounded-full transition ${mode === "sticker" ? "bg-[#FF5A00] text-black" : "text-zinc-400 hover:text-zinc-200"}`}
        >Stickers</button>
        <div className="text-[10px] text-zinc-600 ml-2 hidden sm:block">Powered by GIPHY</div>
        <button
          onClick={onClose}
          data-testid="giphy-close"
          className="ml-auto p-1 text-zinc-500 hover:text-zinc-200"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-zinc-900 flex items-center gap-2">
        <Search size={14} className="text-zinc-500 shrink-0" />
        <input
          ref={inputRef}
          data-testid="giphy-search"
          className="flex-1 bg-transparent text-sm outline-none placeholder-zinc-600"
          placeholder={mode === "gif" ? "Search GIFs…" : "Search stickers…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Grid */}
      <div className="max-h-[280px] overflow-y-auto p-2" data-testid="giphy-grid">
        {err === "giphy-key-missing" && (
          <div className="text-[11px] text-amber-300 p-3 text-center">
            Giphy isn't configured yet — ask an admin to add <code>REACT_APP_GIPHY_API_KEY</code> to the frontend env, then rebuild.
          </div>
        )}
        {err && err !== "giphy-key-missing" && (
          <div className="text-[11px] text-red-300 p-3 text-center">
            Couldn't reach Giphy ({err}). Try again in a moment.
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 justify-center py-8 text-zinc-500 text-xs">
            <Loader2 className="animate-spin" size={14} /> Loading…
          </div>
        )}
        {!loading && !err && items.length === 0 && (
          <div className="text-center text-zinc-600 text-xs py-8">
            {query ? `No results for "${query}"` : "Nothing trending yet."}
          </div>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`giphy-item-${item.id}`}
              onClick={() =>
                onSelect({
                  id: item.id,
                  mode,
                  title: item.title,
                  sourceUrl: item.url,
                  previewUrl: pickThumb(item),
                  sendUrl: pickSend(item, mode),
                  attribution: "Powered by GIPHY",
                })
              }
              className="rounded-lg overflow-hidden bg-zinc-900 hover:ring-2 hover:ring-[#FF5A00] transition"
            >
              <img
                src={pickThumb(item)}
                alt={item.alt_text || item.title || "GIPHY item"}
                loading="lazy"
                className="w-full h-24 object-cover"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
