import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X, ChevronLeft, ChevronRight, ZoomIn, ArrowRight } from "lucide-react";
import { fileUrl } from "../lib/api";

/**
 * Full-screen image viewer with pinch-to-zoom support.
 *
 * Props:
 *   items:  Array of image path strings.
 *   index:  Zero-based starting index.
 *   meta:   Optional array (same length as items) of
 *           `{ handle, avatar_path, display_name }` for the author of each
 *           image. When set, a footer with a "Go to #handle's profile"
 *           button renders beneath the image.
 *   onClose(): required.
 */
export default function Lightbox({ items = [], index = 0, meta = null, onClose }) {
  const [i, setI] = useState(Math.max(0, Math.min(index, items.length - 1)));
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const containerRef = useRef(null);
  const pointers = useRef(new Map());
  const initialDist = useRef(null);
  const initialScale = useRef(1);

  const reset = () => { setScale(1); setTx(0); setTy(0); };

  const prev = () => { if (i > 0) { setI(i - 1); reset(); } };
  const next = () => { if (i < items.length - 1) { setI(i + 1); reset(); } };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "+" || e.key === "=") setScale((s) => Math.min(4, s + 0.5));
      else if (e.key === "-") setScale((s) => Math.max(1, s - 0.5));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, items.length]);

  const onPointerDown = (e) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      initialDist.current = Math.hypot(b.x - a.x, b.y - a.y);
      initialScale.current = scale;
    }
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && initialDist.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const s = Math.max(1, Math.min(4, initialScale.current * (d / initialDist.current)));
      setScale(s);
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) initialDist.current = null;
    // Pinch-out release below 1 → snap back
    if (pointers.current.size === 0 && scale < 1) reset();
  };

  const current = items[i];
  if (!current) return null;

  return (
    <div
      data-testid="lightbox"
      className="fixed inset-0 z-[120] bg-black flex items-center justify-center touch-none"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <button
        data-testid="lightbox-close"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 rounded-full bg-black/60 border border-zinc-800 p-2 text-zinc-200 hover:text-white"
        aria-label="Close"
      >
        <X size={18} />
      </button>
      <button
        data-testid="lightbox-zoom-toggle"
        onClick={() => setScale((s) => s > 1 ? 1 : 2)}
        className="absolute top-4 right-16 z-10 rounded-full bg-black/60 border border-zinc-800 p-2 text-zinc-200 hover:text-white"
        aria-label="Zoom"
      >
        <ZoomIn size={18} />
      </button>
      {items.length > 1 && i > 0 && (
        <button
          data-testid="lightbox-prev"
          onClick={prev}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/60 border border-zinc-800 p-2 text-zinc-200 hover:text-white"
          aria-label="Previous"
        >
          <ChevronLeft size={20} />
        </button>
      )}
      {items.length > 1 && i < items.length - 1 && (
        <button
          data-testid="lightbox-next"
          onClick={next}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/60 border border-zinc-800 p-2 text-zinc-200 hover:text-white"
          aria-label="Next"
        >
          <ChevronRight size={20} />
        </button>
      )}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="w-full h-full flex items-center justify-center overflow-hidden"
        style={{ touchAction: "pinch-zoom" }}
      >
        <img
          data-testid="lightbox-image"
          src={fileUrl(current)}
          alt=""
          className="max-w-full max-h-full object-contain select-none"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "center center",
            transition: pointers.current.size === 0 ? "transform 120ms ease" : "none",
            willChange: "transform",
          }}
          draggable={false}
        />
      </div>
      {items.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-zinc-400 bg-black/60 border border-zinc-800 rounded-full px-3 py-1">
          {i + 1} / {items.length}
        </div>
      )}
      {/* Author footer — appears when the caller passes per-item meta.
          Anchored to the bottom edge with a safe-area buffer so it clears
          the phone home-indicator. Clicking "Go to profile" closes the
          lightbox and navigates. */}
      {meta && meta[i] && (
        <div
          data-testid="lightbox-author-footer"
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/70 backdrop-blur-md border border-zinc-800 rounded-2xl px-3 py-2 max-w-[92vw]"
          style={{ bottom: `calc(3.5rem + env(safe-area-inset-bottom, 0px))` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-9 h-9 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
            {meta[i].avatar_path ? (
              <img src={fileUrl(meta[i].avatar_path)} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="font-heading text-zinc-300 text-sm">{(meta[i].handle?.[0] || "?").toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">#{meta[i].handle}</div>
            {meta[i].display_name && (
              <div className="text-[11px] text-zinc-400 truncate">{meta[i].display_name}</div>
            )}
          </div>
          <Link
            to={`/u/${meta[i].handle}`}
            onClick={() => onClose?.()}
            data-testid="lightbox-go-to-profile"
            className="ml-1 inline-flex items-center gap-1 bg-[#FF5A00] hover:bg-[#E65000] text-black text-xs uppercase tracking-[0.15em] font-medium rounded-full px-3 py-1.5 shrink-0"
          >
            Go to profile <ArrowRight size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}
