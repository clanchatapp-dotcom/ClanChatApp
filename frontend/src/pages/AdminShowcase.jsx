import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  ShieldCheck, ShieldAlert, AlertTriangle, EyeOff, Eye, Flag,
  Lock, Sparkles, Camera, MessageCircleOff, UserCog, Users,
} from "lucide-react";

/**
 * /admin/showcase
 *
 * Static demo gallery of every safety UI variant in ClanChat. Renders
 * pinned, deterministic mock content (no real users, no live API calls)
 * so the founder can take press-kit / regulator / app-store-review
 * screenshots without exposing private user data.
 *
 * This page MUST remain a pure presentational component — never wire it
 * to real DMs, real reports, or real accounts. If a future change makes
 * it look like real data, that's a bug. The whole point is "what the
 * UI looks like" without "whose data it is".
 *
 * Locked behind the admin role like the rest of /admin/*.
 */
export default function AdminShowcase() {
  const { user } = useAuth();
  if (user?.role !== "admin") {
    return <div className="p-10 text-zinc-500 text-sm">Admin only.</div>;
  }
  return (
    <div className="px-5 pt-6 pb-24 max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-3xl flex items-center gap-2">
          <Camera size={22} className="text-[#FF5A00]" /> Safety UI Showcase
        </h1>
        <Link to="/admin" className="text-zinc-500 text-sm">Back</Link>
      </header>
      <p className="text-xs text-zinc-500 leading-relaxed mb-8">
        Static gallery of every safety banner, badge, dialog and warning
        rendered with fake demo data. Use it for press kits, app-store
        review submissions, investor decks and Ofcom Online Safety Act
        documentation. Nothing here touches real user records.
      </p>

      <Section title="1. Direct-message screenshot protection">
        <Card>
          <div className="border border-zinc-900 rounded-2xl p-4 bg-zinc-950">
            <div className="flex items-center justify-between mb-2">
              <span className="font-heading">#alex</span>
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                <EyeOff size={10} /> Screenshots blocked
              </span>
            </div>
            <div className="text-xs text-amber-200 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
              <ShieldAlert size={12} className="mt-0.5 shrink-0" />
              <span>You and #alex have screenshots turned off. Android blocks captures natively. On web / iOS we can&apos;t enforce — both sides see this banner.</span>
            </div>
            <Bubble side="them">Hey did you see the news?</Bubble>
            <Bubble side="me">Yeah, can&apos;t believe it</Bubble>
          </div>
        </Card>
        <Card>
          <div className="border border-zinc-900 rounded-2xl p-4 bg-zinc-950">
            <div className="flex items-center justify-between mb-2">
              <span className="font-heading">#alex</span>
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400 bg-zinc-800/40 px-2 py-0.5 rounded border border-zinc-700">
                <Eye size={10} /> Screenshots allowed
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 mb-3">Both parties opted in via Settings → Direct messages → Allow screenshots.</p>
            <Bubble side="them">Mind if I screenshot this?</Bubble>
            <Bubble side="me">Go for it 👍</Bubble>
          </div>
        </Card>
      </Section>

      <Section title="2. Adult-cannot-DM-minor (hardcoded)">
        <Card>
          <div className="border border-red-500/40 bg-red-500/5 rounded-2xl p-4">
            <div className="flex items-start gap-2 text-red-200">
              <Lock size={14} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-sm">DM not allowed</div>
                <p className="text-xs mt-1 leading-relaxed">
                  Adults cannot DM minor accounts unless the minor opens the conversation first. This is a hardcoded protection — no admin override exists.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="3. Account flags (minor vs adult vs 18+ creator)">
        <Card>
          <FlagBadge color="amber" icon={<UserCog size={11} />} label="MINOR" />
          <p className="text-[11px] text-zinc-500 mt-2">
            Set automatically by DOB at registration, or manually by admin via{" "}
            <span className="text-zinc-300">/admin → Users → Lock as minor</span>.
            Locked accounts cannot enable NSFW, are invisible to 18+ creator search,
            and adults can&apos;t initiate contact.
          </p>
        </Card>
        <Card>
          <FlagBadge color="zinc" icon={<Users size={11} />} label="ADULT · STANDARD" />
          <p className="text-[11px] text-zinc-500 mt-2">
            Default for any account where the DOB resolves to 18+. Can see and contact other adults normally. Cannot find or contact minors unless the minor reaches out first.
          </p>
        </Card>
        <Card>
          <FlagBadge color="fuchsia" icon={<Sparkles size={11} />} label="18+ CREATOR" />
          <p className="text-[11px] text-zinc-500 mt-2">
            Admin-applied via{" "}
            <span className="text-zinc-300">/admin → Users → Flag as 18+ creator</span>.
            Invisible to minors in search results. NSFW posting enabled. Reason and admin ID are logged in <span className="text-zinc-300">audit_events</span>.
          </p>
        </Card>
      </Section>

      <Section title="4. Three-tier post visibility">
        <Card>
          <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">Public</span>
          <p className="text-[11px] text-zinc-500 mt-2">Tier 1 · anyone with an account can see this post. Cannot contain 18+ content (hardcoded).</p>
        </Card>
        <Card>
          <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">Followers</span>
          <p className="text-[11px] text-zinc-500 mt-2">Tier 2 · only approved followers see this. Non-followers see tags as thumbnails with a follow prompt.</p>
        </Card>
        <Card>
          <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-fuchsia-300 bg-fuchsia-500/10 px-2 py-0.5 rounded border border-fuchsia-500/30">Inner Circle</span>
          <p className="text-[11px] text-zinc-500 mt-2">Tier 3 · invisible to everyone outside. Doesn&apos;t appear locked or greyed — it doesn&apos;t exist to non-members. No tags. No traces in search.</p>
        </Card>
      </Section>

      <Section title="5. Comfort Zone — minor lock">
        <Card>
          <div className="border border-zinc-900 rounded-xl p-3 opacity-60">
            <div className="flex items-center justify-between">
              <span className="text-sm">Show 18+ content</span>
              <div className="w-9 h-5 rounded-full bg-zinc-800 relative"><div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-zinc-600" /></div>
            </div>
          </div>
          <p className="text-xs text-red-300 mt-2 flex items-center gap-1">
            <Lock size={11} /> Disabled for under-18 accounts.
          </p>
        </Card>
      </Section>

      <Section title="6. Report system — 7 categories">
        <Card wide>
          <div className="border border-zinc-900 rounded-2xl p-4 bg-zinc-950">
            <div className="flex items-center gap-2 mb-3">
              <Flag size={16} className="text-red-400" />
              <span className="font-heading text-base">Report this post</span>
            </div>
            <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
              Your report is confidential. CSAM reports auto-quarantine the content immediately and route to our compliance queue.
            </p>
            <div className="flex flex-col gap-1.5">
              <ReportRow danger label="Child sexual abuse material (CSAM)" />
              <ReportRow label="Harassment or threats" />
              <ReportRow label="Spam or scam" />
              <ReportRow label="Hate speech" />
              <ReportRow label="Self-harm content" />
              <ReportRow label="Impersonation" />
              <ReportRow label="Other" />
            </div>
          </div>
        </Card>
      </Section>

      <Section title="7. CSAM auto-quarantine confirmation">
        <Card wide>
          <div className="border border-red-500/40 bg-red-500/5 rounded-2xl p-4 flex items-start gap-3">
            <ShieldAlert size={18} className="text-red-400 mt-1 shrink-0" />
            <div>
              <div className="font-heading text-base text-red-100">Content auto-quarantined</div>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
                A CSAM report was filed against this post. The content was removed from public visibility within milliseconds and routed to our human-review queue. Strike 3 (account deletion) will be applied on confirmation. Audit log entry written to <span className="text-zinc-300">csam_reports</span> + <span className="text-zinc-300">audit_events</span>.
              </p>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="8. Strike escalation ladder">
        <Card wide>
          <ol className="space-y-2 text-sm">
            <Step n="W" color="zinc">Soft warning — first offence. Visible message in their inbox. No suspension.</Step>
            <Step n="1" color="amber">Strike 1 — 24–48 hour suspension. Reason given. Counts toward 3.</Step>
            <Step n="2" color="orange">Strike 2 — 7 day suspension. Reason given. One strike from deletion.</Step>
            <Step n="3" color="red">Strike 3 — permanent account deletion. Cannot be reversed.</Step>
          </ol>
        </Card>
      </Section>

      <Section title="9. AI content label (hardcoded on every AI post)">
        <Card>
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-zinc-300 bg-purple-500/10 border border-purple-500/30 px-2 py-1 rounded">
            <Sparkles size={10} /> AI Generated
          </span>
          <p className="text-[11px] text-zinc-500 mt-2">Once applied, this label can&apos;t be removed. Viewers can hide AI posts via Comfort Zone.</p>
        </Card>
        <Card>
          <div className="border border-red-500/40 bg-red-500/5 rounded-xl p-3">
            <div className="text-[11px] uppercase tracking-wider text-red-300 mb-1 flex items-center gap-1">
              <ShieldAlert size={11} /> AI of real person — hard rules
            </div>
            <ul className="text-[11px] text-zinc-300 space-y-1 leading-snug">
              <li>· Without consent → 48hr ban + Strike 1</li>
              <li>· 18+ content depicting them → permanent deletion. No appeal.</li>
            </ul>
          </div>
        </Card>
      </Section>

      <Section title="10. Wall, tag, and DM permission states">
        <Card>
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">Wall</div>
          <p className="text-xs text-zinc-400">Owner only · Followers · Inner Circle. Non-followers never post.</p>
        </Card>
        <Card>
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">Tags</div>
          <p className="text-xs text-zinc-400">Anyone · Followers · Inner Circle · Nobody. 18+ and media tags always need approval.</p>
        </Card>
        <Card>
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1 inline-flex items-center gap-1">
            <MessageCircleOff size={10} /> DMs
          </div>
          <p className="text-xs text-zinc-400">Tier 1 has no DMs ever. Tier 2 optional. Tier 3 per-member toggle.</p>
        </Card>
      </Section>

      <Section title="11. Inner Circle per-member permissions">
        <Card wide>
          <div className="border border-zinc-900 rounded-2xl p-4 bg-zinc-950">
            <div className="font-heading text-base mb-3 flex items-center gap-2">
              <ShieldCheck size={14} className="text-[#FF5A00]" /> #demo_member · permissions
            </div>
            <div className="space-y-2">
              {[
                ["DMs", true],
                ["Audio messages", true],
                ["Audio calls", false],
                ["Video calls", false],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span>{k}</span>
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${v ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30" : "bg-zinc-800/40 text-zinc-500 border border-zinc-700"}`}>
                    {v ? "On" : "Off"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </Section>

      <div className="border-t border-zinc-900 pt-6 mt-8">
        <div className="flex items-start gap-2 text-[11px] text-zinc-500 leading-relaxed">
          <AlertTriangle size={12} className="mt-0.5 text-zinc-600 shrink-0" />
          <p>
            All examples on this page use fake data only — no real account
            handles, DMs, or report records are surfaced. This page renders
            identically for every admin and can be safely captured for any
            external use.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-8">
      <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-3">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </section>
  );
}

function Card({ children, wide }) {
  return (
    <div className={`border border-zinc-900 rounded-2xl p-4 ${wide ? "sm:col-span-2" : ""}`}>
      {children}
    </div>
  );
}

function Bubble({ side, children }) {
  const mine = side === "me";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} mb-2`}>
      <div className={`max-w-[80%] text-sm px-3 py-2 rounded-2xl ${mine ? "bg-[#FF5A00]/15 text-zinc-100 rounded-br-sm" : "bg-zinc-900 text-zinc-200 rounded-bl-sm"}`}>
        {children}
      </div>
    </div>
  );
}

function FlagBadge({ color, icon, label }) {
  const palette = {
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    zinc: "bg-zinc-800/40 text-zinc-300 border-zinc-700",
    fuchsia: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30",
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] font-semibold px-2.5 py-1 rounded border ${palette[color]}`}>
      {icon} {label}
    </span>
  );
}

function ReportRow({ danger, label }) {
  return (
    <label className={`flex items-center justify-between p-2.5 border rounded-xl ${danger ? "border-red-500/40 bg-red-500/5" : "border-zinc-800"}`}>
      <span className={`text-xs inline-flex items-center gap-2 ${danger ? "text-red-200" : "text-zinc-300"}`}>
        {danger && <ShieldAlert size={12} className="text-red-400" />}
        {label}
      </span>
      <span className={`w-3.5 h-3.5 rounded-full border ${danger ? "border-red-400" : "border-zinc-600"}`} />
    </label>
  );
}

function Step({ n, color, children }) {
  const palette = {
    zinc: "bg-zinc-800 text-zinc-300",
    amber: "bg-amber-500/20 text-amber-200",
    orange: "bg-[#FF5A00]/20 text-[#FF5A00]",
    red: "bg-red-500/20 text-red-300",
  };
  return (
    <li className="flex items-start gap-3">
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-heading shrink-0 ${palette[color]}`}>{n}</span>
      <span className="text-zinc-300 leading-snug pt-1">{children}</span>
    </li>
  );
}
