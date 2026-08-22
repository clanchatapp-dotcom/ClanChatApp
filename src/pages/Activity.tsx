import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Avatar, timeAgo } from '../lib/ui'
import { Heart, UserPlus, Lock, Check } from 'lucide-react'

const ICON: any = { like: Heart, follow: UserPlus, follow_request: UserPlus, follow_accepted: Check, inner_invite: Lock, inner_accepted: Lock }

export default function Activity() {
  const [items, setItems] = useState<any[]>([])
  const [reqs, setReqs] = useState<any[]>([])
  const load = () => { api.activity().then(setItems).catch(() => {}); api.followRequests().then(setReqs).catch(() => {}) }
  useEffect(load, [])

  const accept = async (h: string) => { await api.acceptFollow(h); load() }
  const acceptInner = async (h: string) => { await api.acceptInner(h); load() }

  return (
    <div>
      <div className="sticky top-0 z-30 bg-ink/80 backdrop-blur border-b border-edge px-4 py-3"><h1 className="text-xl font-extrabold">Activity</h1></div>
      <div className="p-4 space-y-2">
        {reqs.length > 0 && <div className="bg-panel border border-edge rounded-2xl p-3 mb-2">
          <div className="font-semibold text-slate-300 mb-2">Follow requests</div>
          {reqs.map(r => (
            <div key={r.handle} className="flex items-center gap-3 py-1.5">
              <Avatar id={r.handle} name={r.display_name} url={r.avatar_url} size={36} />
              <div className="flex-1"><span className="font-medium">{r.display_name}</span> <span className="text-slate-500 text-sm">#{r.handle}</span></div>
              <button onClick={() => accept(r.handle)} className="px-3 py-1.5 rounded-lg bg-brand text-sm font-medium">Accept</button>
            </div>
          ))}
        </div>}
        {items.length === 0 && reqs.length === 0 && <p className="text-center text-slate-500 py-10">No activity yet.</p>}
        {items.map(a => {
          const I = ICON[a.type] || Heart
          return (
            <div key={a.id} className="flex items-center gap-3 bg-panel border border-edge rounded-2xl p-3">
              <div className="h-9 w-9 grid place-items-center rounded-full bg-brand/15 text-brand"><I className="h-4 w-4" /></div>
              <Link to={`/u/${a.actor_handle}`}><Avatar id={a.actor_id} name={a.actor_name} size={34} /></Link>
              <div className="flex-1 text-sm"><Link to={`/u/${a.actor_handle}`} className="font-medium hover:underline">{a.actor_name}</Link> {a.text}
                <div className="text-slate-600 text-xs">{timeAgo(a.created_at)}</div></div>
              {a.type === 'inner_invite' && <button onClick={() => acceptInner(a.actor_handle)} className="px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-300 text-sm">Join</button>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
