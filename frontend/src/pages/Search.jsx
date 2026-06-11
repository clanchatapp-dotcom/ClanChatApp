import { useState, useEffect } from "react";
import api from "../lib/api";
import { Link } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import { fileUrl } from "../lib/api";

export default function Search() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const id = setTimeout(async () => {
      try {
        const { data } = await api.get(`/users/search?q=${encodeURIComponent(q.replace(/^#/, ""))}`);
        setResults(data.results || []);
      } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="px-5 pt-6">
      <h1 className="font-heading text-3xl mb-5">Search</h1>
      <div className="relative">
        <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          data-testid="search-input"
          autoFocus
          className="cc-input pl-12 text-base"
          placeholder="Find by # handle"
          value={q} onChange={e => setQ(e.target.value)}
        />
      </div>
      <p className="text-xs text-zinc-600 mt-2"># handles only · adults can't find minors</p>

      <div className="mt-6 flex flex-col gap-1">
        {results.map(u => (
          <Link to={`/u/${u.handle}`} key={u.user_id} data-testid={`search-result-${u.handle}`}
            className="flex items-center gap-3 p-3 rounded-2xl hover:bg-zinc-950 transition">
            <div className="w-12 h-12 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center">
              {u.avatar_path ? (
                <img src={fileUrl(u.avatar_path)} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="font-heading text-zinc-400">{u.handle[0].toUpperCase()}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">#{u.handle}</div>
              <div className="text-xs text-zinc-500 truncate">{u.bio || u.display_name}</div>
            </div>
          </Link>
        ))}
        {q && results.length === 0 && (
          <div className="text-zinc-600 text-sm text-center py-10">No matches.</div>
        )}
      </div>
    </div>
  );
}
