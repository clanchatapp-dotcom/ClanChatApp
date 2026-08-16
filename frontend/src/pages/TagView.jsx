import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../lib/api";
import PostCard from "../components/PostCard";

export default function TagView() {
  const { tag } = useParams();
  const [posts, setPosts] = useState([]);
  useEffect(() => {
    api.get(`/posts/by-tag/${tag}`).then(r => setPosts(r.data.posts)).catch(() => setPosts([]));
  }, [tag]);
  return (
    <div className="px-5 pt-6 pb-24">
      <header className="flex items-center justify-between mb-5">
        <Link to="/feed" className="text-zinc-500 text-sm">← Feed</Link>
      </header>
      <h1 className="font-heading text-3xl">#{tag}</h1>
      <p className="text-xs text-zinc-500 mt-1 mb-5">Public posts tagged {`#${tag}`}</p>
      <div className="flex flex-col gap-3">
        {posts.length === 0 && <div className="text-zinc-600 text-sm text-center py-10">No posts yet.</div>}
        {posts.map(p => <PostCard key={p.post_id} post={p} />)}
      </div>
    </div>
  );
}
