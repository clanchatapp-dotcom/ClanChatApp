import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { Avatar, TIER, TierKey, timeAgo } from '../lib/ui'

export default function PostCard({ post, onDelete }: { post: any; onDelete?: (id: string) => void }) {
  const [liked, setLiked] = useState(post.liked)
  const [count, setCount] = useState(post.like_count)
  const tier = TIER[(post.tier as TierKey)] || TIER.public
  const TierIcon = tier.icon
  const a = post.author || { id: '', handle: 'unknown', display_name: 'Unknown' }

  const like = async () => {
    if (!post.likeable) return
    setLiked(!liked); setCount((c: number) => c + (liked ? -1 : 1))
    try { const r = await api.likePost(post.id); setLiked(r.liked); setCount(r.like_count) } catch {}
  }

  return (
    <article className="bg-panel border border-edge rounded-2xl p-4 animate-pop">
      <div className="flex items-start gap-3">
        <Link to={`/u/${a.handle}`}><Avatar id={a.id} name={a.display_name} url={a.avatar_url} /></Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/u/${a.handle}`} className="font-semibold hover:underline">{a.display_name}</Link>
            <span className="text-slate-500 text-sm">#{a.handle}</span>
            <span className="text-slate-600 text-sm">· {timeAgo(post.created_at)}</span>
            <span className={`ml-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${tier.bg} ${tier.text} ${tier.ring}`}>
              <TierIcon className="h-3 w-3" />{tier.label}
            </span>
          </div>
          {post.text && <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{post.text}</p>}
          {post.media_url && (post.media_type === 'video'
            ? <video src={post.media_url} controls className="mt-3 rounded-xl max-h-96 w-full" />
            : <img src={post.media_url} className="mt-3 rounded-xl max-h-96 object-cover" />)}
          {post.tags?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {post.tags.map((t: string) => <span key={t} className="text-xs text-brand bg-brand/10 px-2 py-0.5 rounded-full">#{t}</span>)}
            </div>
          )}
          <div className="mt-3 flex items-center gap-4 text-slate-400">
            {post.likeable ? (
              <button onClick={like} className={`flex items-center gap-1.5 text-sm hover:text-rose-400 transition ${liked ? 'text-rose-400' : ''}`}>
                <Heart className={`h-4 w-4 ${liked ? 'fill-rose-400' : ''}`} /> {count > 0 && count}
              </button>
            ) : <span className="text-xs text-slate-600">Likes off for this tier</span>}
            {post.is_mine && onDelete && (
              <button onClick={() => onDelete(post.id)} className="ml-auto text-slate-500 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
