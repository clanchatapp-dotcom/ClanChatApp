/**
 * Lightweight client-side NSFW image scanner using NSFW.js loaded from CDN.
 *
 * Design decision: nsfwjs's npm package ships model shards with dynamic
 * `require()` calls that webpack can't statically analyse — trying to
 * bundle it breaks the build. Loading from a CDN via <script> tags
 * bypasses webpack entirely and keeps the bundle lean.
 *
 * The models (~4MB) load lazily on first scan so they don't bloat page
 * load. Cached on `window` for reuse.
 *
 * Only images are scanned. Videos + audio are skipped (accurate video
 * scanning client-side is expensive and unreliable).
 */

const CDN_TF = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js";
const CDN_NSFW = "https://cdn.jsdelivr.net/npm/nsfwjs@4.3.0/dist/nsfwjs.min.js";
const MODEL_URL = "https://cdn.jsdelivr.net/npm/nsfwjs@4.3.0/dist/models/mobilenet_v2/";

let _scriptsPromise = null;
let _modelPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureScripts() {
  if (_scriptsPromise) return _scriptsPromise;
  _scriptsPromise = (async () => {
    await loadScript(CDN_TF);
    await loadScript(CDN_NSFW);
    // Prefer WebGL — falls back to CPU on old Android WebViews automatically.
    try { await window.tf.setBackend("webgl"); } catch { /* fall back to cpu */ }
  })();
  return _scriptsPromise;
}

async function loadModel() {
  if (_modelPromise) return _modelPromise;
  _modelPromise = (async () => {
    await ensureScripts();
    return window.nsfwjs.load(MODEL_URL, { type: "graph" });
  })();
  return _modelPromise;
}

/**
 * Classify one File/Blob. Returns:
 *   {
 *     verdict: "safe" | "nsfw" | "unknown",
 *     score:   0..1     (confidence of the top NSFW class)
 *     top:     className string
 *     raw:     full nsfwjs.classify output
 *   }
 *
 * Threshold rules (tuned for low false-positive rate):
 *   - Porn class ≥ 0.55           → nsfw
 *   - Hentai class ≥ 0.55         → nsfw
 *   - Sexy class ≥ 0.70           → nsfw
 *   - otherwise                    → safe
 *
 * If the model or scripts fail to load (offline, CDN block, ...) the
 * verdict is "unknown" and the caller proceeds without a client-side
 * block — server-side moderation is still the ultimate line of defence.
 */
export async function scanImage(file) {
  if (!file || !file.type?.startsWith("image/")) {
    return { verdict: "unknown", score: 0, top: "", raw: [] };
  }
  try {
    const model = await loadModel();
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width; canvas.height = bmp.height;
    canvas.getContext("2d").drawImage(bmp, 0, 0);
    const preds = await model.classify(canvas);
    bmp.close?.();
    const map = Object.fromEntries(preds.map((p) => [p.className, p.probability]));
    const porn = map.Porn ?? 0;
    const hentai = map.Hentai ?? 0;
    const sexy = map.Sexy ?? 0;
    const top = preds.reduce((a, b) => a.probability > b.probability ? a : b);
    const nsfw = porn >= 0.55 || hentai >= 0.55 || sexy >= 0.70;
    return {
      verdict: nsfw ? "nsfw" : "safe",
      score: Math.max(porn, hentai, sexy),
      top: top.className,
      raw: preds,
    };
  } catch (e) {
    console.warn("NSFW scan unavailable:", e);
    return { verdict: "unknown", score: 0, top: "", raw: [] };
  }
}
