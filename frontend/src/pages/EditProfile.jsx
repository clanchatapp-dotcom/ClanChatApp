import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import api, { formatApiError } from "../lib/api";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

export default function EditProfile() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [displayName, setDisplayName] = useState(user.display_name || "");
  const [bio, setBio] = useState(user.bio || "");
  const [links, setLinks] = useState(user.links?.length ? user.links : []);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch("/users/me", {
        display_name: displayName, bio,
        links: links.filter(l => l.label && l.url),
      });
      toast.success("Profile updated");
      refresh();
      nav(`/me`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-3xl">Edit profile</h1>
        <Link to="/me" className="text-zinc-500 text-sm">Cancel</Link>
      </header>

      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Display name</label>
      <input data-testid="edit-display" className="cc-input mt-2 mb-4" value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={40} />

      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Bio ({bio.length}/150)</label>
      <textarea data-testid="edit-bio" className="cc-input mt-2 mb-4 min-h-[90px] resize-none" maxLength={150}
        value={bio} onChange={e => setBio(e.target.value)} />

      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Links</label>
      <div className="flex flex-col gap-2 mt-2 mb-4">
        {links.map((l, i) => (
          <div key={i} className="flex gap-2">
            <input className="cc-input flex-1" placeholder="Label" value={l.label}
              data-testid={`link-label-${i}`}
              onChange={e => setLinks(links.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} />
            <input className="cc-input flex-[2]" placeholder="https://…" value={l.url}
              data-testid={`link-url-${i}`}
              onChange={e => setLinks(links.map((x, idx) => idx === i ? { ...x, url: e.target.value } : x))} />
            <button onClick={() => setLinks(links.filter((_, idx) => idx !== i))} className="text-zinc-500 p-2"><X size={14} /></button>
          </div>
        ))}
        {links.length < 10 && (
          <button data-testid="add-link" onClick={() => setLinks([...links, { label: "", url: "" }])} className="cc-btn-secondary text-xs py-2 inline-flex items-center gap-2 justify-center">
            <Plus size={14} /> Add link
          </button>
        )}
      </div>

      <button data-testid="save-profile" onClick={save} disabled={busy} className="cc-btn-primary w-full">{busy ? "Saving…" : "Save"}</button>
    </div>
  );
}
