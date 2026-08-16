import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import api, { fileUrl } from "../lib/api";
import { ArrowLeft, Users } from "lucide-react";

export default function MyConnections() {
  const { kind } = useParams(); // "followers" or "following"
  const nav = useNavigate();
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/users/me/${kind}`)
      .then((r) => setPeople(kind === "followers" ? r.data.followers : r.data.following))
      .catch(() => setPeople([]))
      .finally(() => setLoading(false));
  }, [kind]);

  const title = kind === "followers" ? "My followers" : "I follow";
  const empty = kind === "followers" ? "No followers yet." : "You're not following anyone yet.";

  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center gap-3 mb-5">
        <button onClick={() => nav(-1)} data-testid="conn-back" className="text-zinc-500">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-heading text-3xl">{title}</h1>
      </header>

      <p className="text-xs text-zinc-600 -mt-2 mb-4 inline-flex items-center gap-1.5">
        <Users size={11} /> Private to you. No one else sees this list.
      </p>

      {loading && <div className="text-zinc-600 text-sm text-center py-10">Loading…</div>}
      {!loading && people.length === 0 && (
        <div className="text-zinc-600 text-sm text-center py-10">{empty}</div>
      )}

      <div className="flex flex-col gap-1">
        {people.map((u) => (
          <Link
            key={u.user_id}
            to={`/u/${u.handle}`}
            data-testid={`conn-${u.handle}`}
            className="flex items-center gap-3 p-3 rounded-2xl hover:bg-zinc-950 transition"
          >
            <div className="w-12 h-12 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
              {u.avatar_path
                ? <img src={fileUrl(u.avatar_path)} alt="" className="w-full h-full object-cover" />
                : <span className="font-heading text-zinc-400">{u.handle?.[0]?.toUpperCase()}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">#{u.handle}</div>
              <div className="text-xs text-zinc-500 truncate">{u.bio || u.display_name}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
