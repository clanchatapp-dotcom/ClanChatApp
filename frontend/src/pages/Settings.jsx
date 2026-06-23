import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import api, { formatApiError } from "../lib/api";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Sun, Moon, LogOut, ShieldCheck, AlertTriangle } from "lucide-react";

export default function Settings() {
  const { user, refresh, theme, setTheme, logout } = useAuth();
  const nav = useNavigate();
  const s = user?.settings || {};
  const cz = s.comfort_zone || {};

  const [followMode, setFollowMode] = useState(user.follow_mode);
  const [nsfwAccount, setNsfwAccount] = useState(!!user.nsfw_account);
  const [dmsFollowers, setDmsFollowers] = useState(s.dms_enabled_followers);
  const [wallPerm, setWallPerm] = useState(s.wall_post_permission || "owner");
  const [taggableBy, setTaggableBy] = useState(s.taggable_by || "followers");
  const [tagApproval, setTagApproval] = useState(!!s.tag_approval_mode);
  const [realNameVis, setRealNameVis] = useState(s.real_name_visibility || "nobody");
  // comfort zone
  const [nsfw, setNsfw] = useState(!!cz.nsfw);
  const [ai, setAi] = useState(cz.ai_content !== false);
  const [strong, setStrong] = useState(cz.strong_language !== false);
  const [violence, setViolence] = useState(!!cz.violence);
  const [sensitive, setSensitive] = useState(!!cz.sensitive);
  const [anon, setAnon] = useState(cz.anonymous_accounts !== false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch("/users/me", {
        follow_mode: followMode,
        nsfw_account: nsfwAccount,
        real_name_visibility: realNameVis,
        settings: {
          dms_enabled_followers: dmsFollowers,
          wall_post_permission: wallPerm,
          taggable_by: taggableBy,
          tag_approval_mode: tagApproval,
          real_name_visibility: realNameVis,
          comfort_zone: {
            nsfw, ai_content: ai, strong_language: strong, violence,
            sensitive, anonymous_accounts: anon,
          },
        },
      });
      toast.success("Saved");
      refresh();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-3xl">Settings</h1>
        <Link to="/feed" className="text-zinc-500 text-sm">Done</Link>
      </header>

      {/* Strikes — always visible */}
      <Section title="My strikes">
        <div className="border border-zinc-900 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={18} className={user.strikes ? "text-red-400" : "text-zinc-600"} />
          <div className="flex-1">
            <div className="text-sm">{user.strikes || 0} of 3 strikes</div>
            <div className="text-xs text-zinc-500">3 strikes is permanent deletion. Strikes may expire after 12 months of clean behaviour.</div>
          </div>
          <span data-testid="strike-count" className="text-xl font-heading text-zinc-300">{user.strikes || 0}</span>
        </div>
        {(user.strike_history || []).length > 0 && (
          <details className="mt-2">
            <summary className="text-xs text-zinc-500 cursor-pointer">View history</summary>
            <ul className="mt-2 space-y-1">
              {user.strike_history.map((h, i) => (
                <li key={i} className="text-xs text-zinc-400 border-l-2 border-zinc-800 pl-2">
                  Strike {h.level} · {h.reason} · {new Date(h.applied_at).toLocaleDateString()}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title="Theme">
        <div className="flex gap-2">
          <button data-testid="theme-dark" onClick={() => setTheme("dark")}
            className={`flex-1 p-3 rounded-xl border flex items-center gap-2 justify-center text-sm ${theme === "dark" ? "border-[#FF5A00] text-[#FF5A00]" : "border-zinc-900 text-zinc-400"}`}>
            <Moon size={16} /> Dark
          </button>
          <button data-testid="theme-light" onClick={() => setTheme("light")}
            className={`flex-1 p-3 rounded-xl border flex items-center gap-2 justify-center text-sm ${theme === "light" ? "border-[#FF5A00] text-[#FF5A00]" : "border-zinc-900 text-zinc-400"}`}>
            <Sun size={16} /> Light
          </button>
        </div>
      </Section>

      <Section title="Who can follow me">
        <Radio name="follow" value={followMode} onChange={setFollowMode}
          options={[
            { v: "open", l: "Open · anyone can follow" },
            { v: "approval", l: "Approval required" },
          ]} testIdPrefix="follow-mode" />
      </Section>

      <Section title="Wall posts">
        <Radio name="wall" value={wallPerm} onChange={setWallPerm}
          options={[
            { v: "owner", l: "Only me" },
            { v: "followers", l: "Followers" },
            { v: "inner", l: "Inner Circle" },
          ]} testIdPrefix="wall-perm" />
      </Section>

      <Section title="Who can tag me">
        <Radio name="tag" value={taggableBy} onChange={setTaggableBy}
          options={[
            { v: "anyone", l: "Anyone" },
            { v: "followers", l: "Followers" },
            { v: "inner", l: "Inner Circle only" },
            { v: "nobody", l: "Nobody" },
          ]} testIdPrefix="taggable-by" />
        <Toggle label="Approve every tag before it appears on me"
          checked={tagApproval} onChange={setTagApproval} testId="toggle-tag-approval" />
        <p className="text-[11px] text-zinc-600 mt-1">18+ tags and photo/video tags always require manual approval — hardcoded, no override.</p>
      </Section>

      <Section title="Real name">
        <p className="text-xs text-zinc-500 mb-2">Held internally for verification. Set or change it in Edit Profile.</p>
        <Radio name="rn" value={realNameVis} onChange={setRealNameVis}
          options={[
            { v: "nobody", l: "Nobody (default)" },
            { v: "inner", l: "Inner Circle only" },
            { v: "followers", l: "All followers" },
            { v: "everyone", l: "Everyone" },
          ]} testIdPrefix="rn-vis" />
      </Section>

      <Section title="Direct messages">
        <Toggle label="Allow DMs from approved followers (Tier 2)"
          checked={dmsFollowers} onChange={setDmsFollowers} testId="toggle-dms-followers" />
        <p className="text-xs text-zinc-600 mt-2">Tier 1 has no DMs. Inner Circle DMs are controlled per-member.</p>
      </Section>

      <Section title="My Comfort Zone">
        <Toggle label="Show 18+ content" checked={nsfw} onChange={user.is_minor ? () => {} : setNsfw}
          disabled={user.is_minor} testId="toggle-nsfw" />
        {user.is_minor && <p className="text-xs text-red-400 mt-1">Disabled for under-18 accounts.</p>}
        <Toggle label="Show AI content" checked={ai} onChange={setAi} testId="toggle-ai" />
        <Toggle label="Allow strong language" checked={strong} onChange={setStrong} testId="toggle-strong" />
        <Toggle label="Show graphic violence" checked={violence} onChange={setViolence} testId="toggle-violence" />
        <Toggle label="Show sensitive topics (drugs, self-harm, eating disorders)" checked={sensitive} onChange={setSensitive} testId="toggle-sensitive" />
        <Toggle label="Show anonymous accounts in feed" checked={anon} onChange={setAnon} testId="toggle-anon" />
      </Section>

      {!user.is_minor && (
        <Section title="Account flag">
          <Toggle label="Flag account as 18+ (hides me from minors in search)"
            checked={nsfwAccount} onChange={setNsfwAccount} testId="toggle-nsfw-account" />
        </Section>
      )}

      <Section title="Inner Circle">
        <Link to="/inner" data-testid="inner-manage-link" className="cc-btn-secondary w-full text-sm text-center block">Manage Inner Circle</Link>
      </Section>

      {user.role === "admin" && (
        <Section title="Admin">
          <Link to="/admin" data-testid="admin-link" className="cc-btn-secondary w-full text-sm text-center block inline-flex items-center justify-center gap-2">
            <ShieldCheck size={14} /> Open admin panel
          </Link>
        </Section>
      )}

      <button onClick={save} disabled={busy} data-testid="save-settings"
        className="cc-btn-primary w-full mt-2">{busy ? "Saving…" : "Save settings"}</button>

      <button onClick={async () => { await logout(); nav("/"); }} data-testid="logout-btn"
        className="cc-btn-secondary w-full mt-4 inline-flex items-center justify-center gap-2 text-red-400">
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-6">
      <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-3">{title}</div>
      {children}
    </section>
  );
}

function Toggle({ label, checked, onChange, testId, disabled }) {
  return (
    <label className={`flex items-center justify-between p-3 border border-zinc-900 rounded-xl mt-2 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <span className="text-sm">{label}</span>
      <input data-testid={testId} type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)} className="accent-[#FF5A00]" />
    </label>
  );
}

function Radio({ name, value, onChange, options, testIdPrefix }) {
  return (
    <div className="flex flex-col gap-2">
      {options.map(o => (
        <label key={o.v} className="flex items-center justify-between p-3 border border-zinc-900 rounded-xl cursor-pointer">
          <span className="text-sm">{o.l}</span>
          <input type="radio" name={name} checked={value === o.v} onChange={() => onChange(o.v)}
            data-testid={`${testIdPrefix}-${o.v}`} className="accent-[#FF5A00]" />
        </label>
      ))}
    </div>
  );
}
