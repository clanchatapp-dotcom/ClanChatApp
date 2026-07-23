import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, ZoomIn } from "lucide-react";
import { fileUrl } from "../lib/api";

/**
 * Full-screen image viewer with pinch-to-zoom support.
 *
 * Design notes
 * ------------
 * Pinch-zoom is done with `touch-action: pinch-zoom` on the image + a
 * simple two-pointer scale tracker. Native browser gestures do the real
 * work — we just track transform state so the reset button can restore
 * the identity transform between images.
 *
 * Keyboard: Esc closes, Left/Right navigates, `+` / `-` zoom on desktop.
 *
 * Props:
 *   items:  Array of media path strings (may include a mix of images,
 *           videos, audio; we render only images in this viewer — videos
 *           and audio still render inline).
 *   index:  Zero-based starting index inside `items`.
 *   onClose(): required.
 */
export default function Lightbox({ items = [], index = 0, onClose }) {
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
    </div>
  );
}
