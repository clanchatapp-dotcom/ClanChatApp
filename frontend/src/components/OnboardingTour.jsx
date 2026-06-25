import { useEffect, useState } from "react";
import { Layers, ShieldCheck, Users, AtSign, X, ArrowRight } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const STEPS = [
  {
    icon: Layers,
    title: "Three tiers. One simple rule.",
    body: "Every post is Public, Followers, or Inner Circle. Inner Circle is invisible to everyone else — no previews, no traces.",
    chips: ["Public", "Followers", "Inner Circle"],
    accent: "#FF5A00",
  },
  {
    icon: ShieldCheck,
    title: "Your Comfort Zone",
    body: "You decide what reaches your feed. Toggle 18+, AI content, strong language, violence, and sensitive topics in Settings.",
    chips: ["Settings → My Comfort Zone"],
    accent: "#22D3EE",
  },
  {
    icon: Users,
    title: "Inner Circle is invite-only",
    body: "Hand-pick up to 50 people. Per-member permissions for DMs, audio, calls. Group chats live here too — max 15, everyone accepts.",
    chips: ["Invite-only", "Per-member perms", "Group chats"],
    accent: "#A78BFA",
  },
  {
    icon: AtSign,
    title: "Tags ask first.",
    body: "When someone tags you on media or 18+ content, you approve it before it goes live on your profile. Always. No override.",
    chips: ["Tag approval queue", "Hardcoded for media + 18+"],
    accent: "#34D399",
  },
];

const storageKey = (uid) => `clanchat_tour_seen_${uid}`;

export default function OnboardingTour() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!user?.user_id) return;
    try {
      const seen = localStorage.getItem(storageKey(user.user_id));
      if (!seen) setOpen(true);
    } catch { /* ignore */ }
  }, [user?.user_id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    if (user?.user_id) {
      try { localStorage.setItem(storageKey(user.user_id), "1"); } catch { /* ignore */ }
    }
    setOpen(false);
  };

  if (!open || !user) return null;

  const step = STEPS[idx];
  const Icon = step.icon;
  const isLast = idx === STEPS.length - 1;

  return (
    <div
      data-testid="onboarding-tour"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in"
      onClick={close}
    >
      <div
        className="relative w-full max-w-md mx-auto bg-zinc-950 border border-zinc-800 rounded-t-3xl sm:rounded-3xl p-6 pb-8 m-0 sm:m-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          data-testid="onboarding-close"
          onClick={close}
          className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 p-1"
          aria-label="Skip tour"
        >
          <X size={18} />
        </button>

        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: `${step.accent}1A`, color: step.accent }}
        >
          <Icon size={26} strokeWidth={1.6} />
        </div>

        <h2 className="font-heading text-2xl leading-tight mb-2" data-testid="onboarding-title">
          {step.title}
        </h2>
        <p className="text-sm text-zinc-400 leading-relaxed">{step.body}</p>

        <div className="flex flex-wrap gap-1.5 mt-4">
          {step.chips.map((c) => (
            <span
              key={c}
              className="text-[10px] uppercase tracking-[0.18em] px-2.5 py-1 rounded-full border"
              style={{ borderColor: `${step.accent}40`, color: step.accent, background: `${step.accent}0D` }}
            >
              {c}
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between mt-7">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                data-testid={`onboarding-dot-${i}`}
                onClick={() => setIdx(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? "w-6 bg-[#FF5A00]" : "w-1.5 bg-zinc-700 hover:bg-zinc-500"
                }`}
                aria-label={`Step ${i + 1}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!isLast && (
              <button
                data-testid="onboarding-skip"
                onClick={close}
                className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-2"
              >
                Skip
              </button>
            )}
            <button
              data-testid={isLast ? "onboarding-finish" : "onboarding-next"}
              onClick={() => (isLast ? close() : setIdx(idx + 1))}
              className="cc-btn-primary py-2 px-4 text-sm inline-flex items-center gap-1.5"
            >
              {isLast ? "Got it" : "Next"}
              {!isLast && <ArrowRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
