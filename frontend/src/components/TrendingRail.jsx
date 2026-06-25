import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { TrendingUp } from "lucide-react";

export default function TrendingRail() {
  const [trending, setTrending] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get("/tags/trending")
      .then((r) => { if (!cancelled) setTrending(r.data.trending || []); })
      .catch((e) => console.warn("trending fetch failed", e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <aside
      data-testid="trending-rail"
      className="hidden xl:flex flex-col w-72 shrink-0 px-5 py-7 sticky top-0 h-screen"
    >
      <div className="border border-zinc-900 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={14} className="text-[#FF5A00]" />
          <h3 className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Trending · 24h</h3>
        </div>

        {loading && <div className="text-xs text-zinc-600">Loading…</div>}

        {!loading && trending.length === 0 && (
          <div className="text-xs text-zinc-600 leading-relaxed">
            Nothing trending yet. Be the first to post with a tag.
          </div>
        )}

        <ul className="flex flex-col gap-1.5">
          {trending.map((t, i) => (
            <li key={t.tag}>
              <Link
                to={`/t/${t.tag}`}
                data-testid={`trending-${t.tag}`}
                className="flex items-baseline justify-between py-1.5 px-2 rounded hover:bg-zinc-900 transition group"
              >
                <span className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[10px] text-zinc-600 tabular-nums w-4 text-right">{i + 1}</span>
                  <span className="text-sm text-zinc-200 group-hover:text-[#FF5A00] truncate">#{t.tag}</span>
                </span>
                <span className="text-[10px] text-zinc-600 tabular-nums shrink-0 ml-2">{t.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[10px] text-zinc-700 mt-4 leading-relaxed">
        Chronological &amp; cohort-free. No algorithm decides what you see — just what your people are talking about.
      </p>
    </aside>
  );
}
