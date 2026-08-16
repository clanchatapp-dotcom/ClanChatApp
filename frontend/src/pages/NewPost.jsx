import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError, fileUrl, uploadFile } from "../lib/api";
import { Sparkles, X, ImagePlus, AlertTriangle, ShieldAlert, AtSign, Music2, Mic } from "lucide-react";
import { toast } from "sonner";
import useMediaPermission from "../hooks/useMediaPermission";
import VoiceRecorder from "../components/VoiceRecorder";
import { useAuth } from "../context/AuthContext";
import { scanImage } from "../lib/nsfwScanner";

const TIERS = [
  { id: "public", label: "Public", desc: "Everyone can see" },
  { id: "followers", label: "Followers", desc: "Approved followers only" },
  { id: "inner", label: "Inner Circle", desc: "Invisible to others" },
];

const AI_LABELS = [
  { id: "", label: "Not AI" },
  { id: "generated", label: "AI Generated" },
  { id: "assisted", label: "AI Assisted" },
  { id: "altered", label: "AI Altered" },
];

export default function NewPost() {
  const nav = useNavigate();
  const { user: me } = useAuth();
  const isMinor = !!me?.is_minor;
  const [content, setContent] = useState("");
  const [tier, setTier] = useState("public");
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState("");
  const [media, setMedia] = useState([]); // [{path, content_type}]
  const [aiLabel, setAiLabel] = useState("");
  const [depictsReal, setDepictsReal] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);
  const [nsfw, setNsfw] = useState(false);
  const [busy, setBusy] = useState(false);
  // Tag people
  const [people, setPeople] = useState([]); // [{user_id, handle}]
  const [peopleSearch, setPeopleSearch] = useState("");
  const [peopleResults, setPeopleResults] = useState([]);
  // Audio track
  const [isAudio, setIsAudio] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const fileRef = useRef(null);
  const audioFileRef = useRef(null);
  const { ensureMediaPermission, MediaPermissionDialog } = useMediaPermission();

  const runPeopleSearch = async (v) => {
    setPeopleSearch(v);
    const q = v.replace(/^#/, "").trim();
    if (!q) { setPeopleResults([]); return; }
    try {
      const { data } = await api.get(`/users/search?q=${encodeURIComponent(q)}`);
      setPeopleResults(data.results || []);
    } catch { setPeopleResults([]); }
  };

  const addPerson = (u) => {
    if (people.find(p => p.user_id === u.user_id)) return;
    if (people.length >= 10) { toast.error("Max 10 tagged people"); return; }
    setPeople([...people, u]);
    setPeopleSearch(""); setPeopleResults([]);
  };

  const addTagFromDraft = (raw) => {
    const clean = raw.toLowerCase().trim().replace(/^#/, "").replace(/[^a-z0-9]/g, "");
    if (!clean) return;
    if (tags.includes(clean)) return;
    if (tags.length >= 10) { toast.error("Max 10 tags"); return; }
    setTags([...tags, clean]);
  };

  const onTagKey = (e) => {
    if (e.key === " " || e.key === "," || e.key === "Enter") {
      e.preventDefault();
      addTagFromDraft(tagDraft);
      setTagDraft("");
    } else if (e.key === "Backspace" && !tagDraft && tags.length) {
      setTags(tags.slice(0, -1));
    }
  };

  const onTagChange = (e) => {
    const v = e.target.value;
    if (v.endsWith(" ") || v.endsWith(",")) {
      addTagFromDraft(v.slice(0, -1));
      setTagDraft("");
    } else { setTagDraft(v); }
  };

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files.slice(0, 4)) {
      // NSFW scan BEFORE upload for images. Videos/audio are skipped —
      // NSFW.js only handles images. Server-side moderation still catches
      // anything we miss.
      if (f.type?.startsWith("image/")) {
        try {
          const result = await scanImage(f);
          if (result.verdict === "nsfw") {
            if (isMinor) {
              toast.error("This image was flagged as adult content. Minors cannot post 18+ content.");
              continue;
            }
            if (tier === "public") {
              toast.error("This image was flagged as adult content. Switch the tier to Followers or Inner Circle to post it.");
              continue;
            }
            if (!nsfw) {
              // Auto-flag the post 18+ so it's gated correctly downstream.
              setNsfw(true);
              toast.warning(`Image auto-flagged as 18+ (${result.top} ${Math.round(result.score * 100)}%). You can uncheck if this is a false positive.`);
            }
          }
        } catch (scanErr) {
          console.warn("NSFW scan failed (proceeding without):", scanErr);
        }
      }
      try {
        const data = await uploadFile(f, "post");
        setMedia(m => [...m, data]);
      } catch (e2) {
        toast.error(formatApiError(e2.response?.data?.detail) || e2.message);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  // Music/audio file upload (from Wall Audio section) — auto marks post as audio track
  const onAudioFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    for (const f of files.slice(0, 2)) {
      try {
        const data = await uploadFile(f, "audio");
        // Server may return image/* MIME for some containers; force audio so preview renders correctly.
        const ct = (data.content_type || "").startsWith("audio") ? data.content_type : (f.type || "audio/mpeg");
        setMedia(m => [...m, { ...data, content_type: ct }]);
        setIsAudio(true);
      } catch (e2) {
        toast.error(formatApiError(e2.response?.data?.detail) || e2.message);
      }
    }
    if (audioFileRef.current) audioFileRef.current.value = "";
  };

  // Voice recorder finished → attach as audio media and mark post as audio track
  const onVoiceNoteReady = async (path) => {
    setMedia(m => [...m, { path, content_type: "audio/webm" }]);
    setIsAudio(true);
    setShowRecorder(false);
    toast.success("Voice note attached");
  };

  const removeMedia = (i) => setMedia(m => m.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!content.trim() && media.length === 0) {
      toast.error("Add some content"); return;
    }
    if (tier === "public" && nsfw) {
      toast.error("Public posts cannot contain 18+ content"); return;
    }
    if (nsfw && isMinor) {
      toast.error("You must be 18 or older to mark posts as 18+"); return;
    }
    // Bug fix: previously the app popped a "Looks like this might be AI
    // generated" confirm on every post that included media, regardless of
    // whether any actual AI detection had happened. That flagged every
    // legit photo/video as suspicious and broke posting UX.
    //
    // Until real AI-image detection is wired in (Phase 2 / Hive), the AI
    // label is voluntary: users who want to be transparent tick it in the
    // form; everyone else posts normally. Backend enforcement still catches
    // abuse — labelled AI + real person + NSFW = strike, unlabelled AI can
    // be reported.
    if (aiLabel && depictsReal && nsfw) {
      toast.error("AI sexual content depicting real people is permanently banned. Do not post this."); return;
    }
    if (aiLabel && depictsReal && !hasConsent) {
      toast.error("You must confirm explicit consent from the real person depicted."); return;
    }
    setBusy(true);
    try {
      await api.post("/posts", {
        content, tier,
        tags: tier === "inner" ? [] : tags,
        media_paths: media.map(m => m.path),
        ai_label: aiLabel || null,
        depicts_real_person: !!aiLabel && depictsReal,
        has_consent: !!aiLabel && depictsReal && hasConsent,
        nsfw,
        tagged_user_ids: people.map(p => p.user_id),
        is_audio_track: isAudio,
      });
      toast.success("Posted");
      nav("/feed");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  return (
    <div className="px-5 pt-6 pb-32">
      <header className="flex items-center justify-between mb-4">
        <h1 className="font-heading text-2xl">New post</h1>
        <button onClick={() => nav(-1)} className="text-zinc-500" data-testid="cancel-post"><X size={20} /></button>
      </header>

      {/* Tier selector — 3 equal columns that always fit their content.
          min-w-0 lets the flex/grid child shrink instead of overflowing.
          The label uses smaller uppercase text on tiny screens to keep
          "INNER CIRCLE" on one line, then scales up on larger widths. */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {TIERS.map(t => (
          <button key={t.id} onClick={() => setTier(t.id)} data-testid={`tier-${t.id}`}
            className={`min-w-0 p-3 border rounded-2xl text-left transition flex flex-col justify-start ${
              tier === t.id ? "border-[#FF5A00] bg-[#FF5A00]/5" : "border-zinc-900 hover:border-zinc-700"
            }`}>
            <div className="text-[10px] sm:text-xs uppercase tracking-[0.14em] font-semibold leading-tight break-words">{t.label}</div>
            <div className="text-[10px] text-zinc-500 mt-1 leading-tight break-words">{t.desc}</div>
          </button>
        ))}
      </div>

      <textarea
        data-testid="post-content"
        className="cc-input min-h-[140px] resize-none"
        placeholder={tier === "inner" ? "Share with your inner circle…" : "What's on your mind?"}
        value={content} onChange={e => setContent(e.target.value)} maxLength={4000}
      />

      {/* Media */}
      {media.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          {media.map((m, i) => (
            <div key={m.path} className="relative aspect-square rounded-2xl overflow-hidden border border-zinc-900">
              {m.content_type?.startsWith("video") ? (
                <video src={fileUrl(m.path)} className="w-full h-full object-cover" />
              ) : m.content_type?.startsWith("audio") ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-purple-900/30 to-zinc-950 p-3">
                  <Music2 size={28} className="text-purple-300" />
                  <audio src={fileUrl(m.path)} controls className="w-full max-w-[92%]" />
                </div>
              ) : (
                <img src={fileUrl(m.path)} alt="" className="w-full h-full object-cover" />
              )}
              <button onClick={() => removeMedia(i)} className="absolute top-2 right-2 bg-black/70 rounded-full p-1.5">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mt-3">
        <button onClick={async () => {
          if (!(await ensureMediaPermission())) return;
          // Defensive: if a prior DM thread left FLAG_SECURE on, lift it so
          // the Android system file picker can actually appear.
          try {
            const Cap = window.Capacitor;
            if (Cap?.isNativePlatform?.() && Cap?.Plugins?.PrivacyScreen?.disable) {
              await Cap.Plugins.PrivacyScreen.disable();
            }
          } catch { /* no-op */ }
          fileRef.current?.click();
        }} className="cc-btn-secondary py-2 px-4 text-sm inline-flex items-center gap-2" data-testid="upload-btn">
          <ImagePlus size={16} /> Add media
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple onChange={onFiles} className="hidden" data-testid="upload-input" />
      </div>

      {/* Audio section — record a voice note OR upload a music/audio file */}
      <div className="mt-3 p-3 border border-zinc-900 rounded-2xl">
        <div className="flex items-center gap-2 mb-2">
          <Music2 size={14} className="text-purple-300" />
          <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Audio</span>
        </div>
        <p className="text-[11px] text-zinc-600 mb-3 leading-snug">
          Record a voice note or upload a music/audio file. Anything added here posts to your Wall&apos;s Audio tab.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!showRecorder ? (
            <button
              type="button"
              data-testid="record-voice-btn"
              onClick={async () => {
                if (!(await ensureMediaPermission())) return;
                setShowRecorder(true);
              }}
              className="cc-btn-secondary py-2 px-4 text-sm inline-flex items-center gap-2"
            >
              <Mic size={16} /> Record voice
            </button>
          ) : (
            <div className="inline-flex items-center gap-2 p-1 border border-zinc-800 rounded-full" data-testid="voice-recorder-wrap">
              <VoiceRecorder
                onSend={onVoiceNoteReady}
                onCancel={() => setShowRecorder(false)}
                maxSeconds={3600}
              />
              <button
                type="button"
                data-testid="voice-recorder-close"
                onClick={() => setShowRecorder(false)}
                className="pr-2 text-[11px] text-zinc-500 hover:text-red-400"
              >
                Cancel
              </button>
            </div>
          )}
          <button
            type="button"
            data-testid="upload-music-btn"
            onClick={async () => {
              if (!(await ensureMediaPermission())) return;
              try {
                const Cap = window.Capacitor;
                if (Cap?.isNativePlatform?.() && Cap?.Plugins?.PrivacyScreen?.disable) {
                  await Cap.Plugins.PrivacyScreen.disable();
                }
              } catch { /* no-op */ }
              audioFileRef.current?.click();
            }}
            className="cc-btn-secondary py-2 px-4 text-sm inline-flex items-center gap-2"
          >
            <Music2 size={16} /> Upload music
          </button>
          <input
            ref={audioFileRef}
            type="file"
            accept="audio/*"
            multiple
            onChange={onAudioFiles}
            className="hidden"
            data-testid="upload-music-input"
          />
        </div>
      </div>

      {/* Tags */}
      {tier !== "inner" && (
        <div className="mt-5">
          <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Tags ({tags.length}/10)</label>
          <div className="cc-input flex flex-wrap gap-2 mt-2">
            {tags.map(t => (
              <span key={t} className="tag-chip">
                #{t}
                <button onClick={() => setTags(tags.filter(x => x !== t))} className="ml-1 text-zinc-500 hover:text-red-400"><X size={12} /></button>
              </span>
            ))}
            <input
              data-testid="tag-input"
              className="flex-1 bg-transparent outline-none text-sm min-w-[100px]"
              value={tagDraft} onChange={onTagChange} onKeyDown={onTagKey}
              placeholder={tags.length === 0 ? "space or comma to add" : ""}
            />
          </div>
          <p className="text-[11px] text-zinc-600 mt-1">lowercase letters/numbers only · banned words blocked</p>
        </div>
      )}

      {/* Tag people */}
      <div className="mt-5">
        <label className="text-xs uppercase tracking-[0.2em] text-zinc-500 inline-flex items-center gap-1">
          <AtSign size={11} /> Tag people ({people.length}/10)
        </label>
        <div className="cc-input flex flex-wrap gap-2 mt-2">
          {people.map(p => (
            <span key={p.user_id} className="tag-chip">
              #{p.handle}
              <button onClick={() => setPeople(people.filter(x => x.user_id !== p.user_id))} className="ml-1 text-zinc-500 hover:text-red-400"><X size={12} /></button>
            </span>
          ))}
          <input
            data-testid="people-input"
            className="flex-1 bg-transparent outline-none text-sm min-w-[100px]"
            value={peopleSearch} onChange={(e) => runPeopleSearch(e.target.value)}
            placeholder={people.length === 0 ? "search by # handle" : ""}
          />
        </div>
        {peopleResults.length > 0 && (
          <div className="mt-1 border border-zinc-900 rounded-xl divide-y divide-zinc-900 max-h-44 overflow-y-auto">
            {peopleResults.map(u => (
              <button key={u.user_id} data-testid={`pick-person-${u.handle}`} onClick={() => addPerson(u)}
                className="w-full text-left p-2 hover:bg-zinc-900 text-sm flex items-center gap-2">
                <span className="text-[#FF5A00]">#{u.handle}</span>
                <span className="text-zinc-500 text-xs truncate">{u.display_name}</span>
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-zinc-600 mt-1">If they require approval, tag stays pending until they accept.</p>
      </div>

      {/* Audio track toggle */}
      <label className="mt-5 flex items-center justify-between p-3 border border-zinc-900 rounded-2xl cursor-pointer">
        <div className="flex items-center gap-3">
          <Music2 size={16} className="text-purple-300" />
          <div>
            <div className="text-sm">Mark as audio track</div>
            <div className="text-[11px] text-zinc-500">Shown on the Audio tab of your profile.</div>
          </div>
        </div>
        <input data-testid="audio-toggle" type="checkbox" checked={isAudio}
          onChange={e => setIsAudio(e.target.checked)} className="accent-[#FF5A00]" />
      </label>

      {/* AI label + consent flow */}
      <div className="mt-6">
        <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">AI content label</label>
        <div className="grid grid-cols-4 gap-1 mt-2">
          {AI_LABELS.map(opt => (
            <button key={opt.id || "none"}
              data-testid={`ai-label-${opt.id || "none"}`}
              onClick={() => { setAiLabel(opt.id); if (!opt.id) { setDepictsReal(false); setHasConsent(false); } }}
              className={`p-2 border rounded-xl text-[10px] uppercase tracking-wider transition ${
                aiLabel === opt.id ? "border-purple-500 bg-purple-500/10 text-purple-200" : "border-zinc-900 text-zinc-500 hover:border-zinc-700"
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
        {aiLabel && (
          <p className="text-[11px] text-purple-300 mt-2 flex items-start gap-1">
            <Sparkles size={12} className="mt-0.5 shrink-0" />
            <span>An AI label will permanently appear on this post — it cannot be removed.</span>
          </p>
        )}
      </div>

      {aiLabel && (
        <div className="mt-3 p-3 border border-purple-500/30 rounded-2xl bg-purple-500/5">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm flex items-center gap-2">
              <ShieldAlert size={14} className="text-purple-300" />
              Does this depict a real person?
            </span>
            <input data-testid="ai-real-person" type="checkbox" checked={depictsReal}
              onChange={e => { setDepictsReal(e.target.checked); if (!e.target.checked) setHasConsent(false); }}
              className="accent-purple-500" />
          </label>
          {depictsReal && (
            <>
              <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                <div className="text-[11px] uppercase tracking-wider text-red-300 mb-2 flex items-center gap-1">
                  <ShieldAlert size={12} /> Hard rules apply
                </div>
                <ul className="text-[12px] text-zinc-300 space-y-1 leading-snug">
                  <li>· Posting without their consent → 48hr ban + Strike 1</li>
                  <li>· If 18+ content depicting them → permanent deletion. No appeal.</li>
                </ul>
              </div>
              <label className="flex items-center justify-between cursor-pointer mt-3">
                <span className="text-sm">I have their explicit consent</span>
                <input data-testid="ai-consent" type="checkbox" checked={hasConsent}
                  onChange={e => setHasConsent(e.target.checked)} className="accent-[#FF5A00]" />
              </label>
            </>
          )}
        </div>
      )}

      {/* Toggles */}
      <div className="mt-3 flex flex-col gap-2">
        {tier !== "public" && !isMinor && (
          <label className="flex items-center justify-between p-3 border border-zinc-900 rounded-2xl cursor-pointer">
            <div className="flex items-center gap-3">
              <AlertTriangle size={16} className="text-red-400" />
              <div>
                <div className="text-sm">18+ content</div>
                <div className="text-[11px] text-zinc-500">Not allowed on Tier 1 Public</div>
              </div>
            </div>
            <input data-testid="nsfw-toggle" type="checkbox" checked={nsfw} onChange={e => setNsfw(e.target.checked)} className="accent-[#FF5A00]" />
          </label>
        )}
        {tier !== "public" && isMinor && (
          <div className="p-3 border border-zinc-900 rounded-2xl bg-zinc-950/60" data-testid="nsfw-minor-locked">
            <div className="flex items-center gap-3">
              <ShieldAlert size={16} className="text-emerald-400" />
              <div>
                <div className="text-sm">18+ tagging is disabled</div>
                <div className="text-[11px] text-zinc-500">You must be 18 or older to mark posts as 18+.</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <button onClick={submit} disabled={busy} className="cc-btn-primary w-full mt-6" data-testid="submit-post">
        {busy ? "Posting…" : `Post to ${TIERS.find(t => t.id === tier).label}`}
      </button>
      <MediaPermissionDialog />
    </div>
  );
}
