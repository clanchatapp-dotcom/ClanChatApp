import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Avatar } from '../lib/ui'
import PostCard from '../components/PostCard'
import { useAuth } from '../lib/auth'
import { MessageCircle, UserPlus, UserCheck, Clock, Lock, Link as LinkIcon, Loader2, Check } from 'lucide-react'

export default function Profile() {
  const { handle } = useParams()
  const nav = useNavigate()
  const { user, refresh } = useAuth()
  const [p, setP] = useState<any>(null)
  const [posts, setPosts] = useState<any[]>([])
  const [editing, setEditing] = useState(false)
  const [bio, setBio] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const prof = await api.getUser(handle!)
      setP(prof); setBio(prof.bio || '')
      setPosts(await api.getUserPosts(handle!))
    } catch { setP(null) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [handle])

  const doFollow = async () => {
    if (p.follow_status) await api.unfollow(p.handle)
    else await api.follow(p.handle)
    load()
  }
  const invite = async () => { await api.inviteInner(p.handle); load() }
  const saveBio = async () => { await api.updateProfile({ bio }); setEditing(false); await refresh(); load() }

  if (loading) return <div className="py-20 grid place-items-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
  if (!p) return <div className="py-20 text-center text-slate-500">User not found.</div>

  return (
    <div>
      <div className="h-32 bg-gradient-to-br from-brand/30 via-violet-600/20 to-transparent" />
      <div className="px-4 -mt-12">
        <div className="flex items-end justify-between">
          <div className="ring-4 ring-ink rounded-full"><Avatar id={p.id} name={p.display_name} url={p.avatar_url} size={88} /></div>
          {p.is_self ? (
            <button onClick={() => setEditing(!editing)} className="px-4 py-2 rounded-xl border border-edge hover:bg-white/5 font-medium">Edit profile</button>
          ) : (
            <div className="flex gap-2">
              {p.can_dm && <button onClick={() => nav(`/messages/${p.handle}`)} className="h-10 w-10 grid place-items-center rounded-xl border border-edge hover:bg-white/5"><MessageCircle className="h-5 w-5" /></button>}
              <button onClick={invite} disabled={p.inner_status === 'accepted'}
                className="h-10 px-3 flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 disabled:opacity-50">
                <Lock className="h-4 w-4" />{p.inner_status === 'accepted' ? 'In Circle' : p.inner_status === 'pending' ? 'Invited' : 'Invite'}
              </button>
              <button onClick={doFollow}
                className={`h-10 px-4 flex items-center gap-1.5 rounded-xl font-semibold ${p.follow_status === 'approved' ? 'border border-edge' : p.follow_status === 'pending' ? 'border border-amber-500/40 text-amber-300' : 'bg-gradient-to-r from-brand to-violet-600'}`}>
                {p.follow_status === 'approved' ? <><UserCheck className="h-4 w-4" />Following</> : p.follow_status === 'pending' ? <><Clock className="h-4 w-4" />Requested</> : <><UserPlus className="h-4 w-4" />Follow</>}
              </button>
            </div>
          )}
        </div>
        <div className="mt-3">
          <h1 className="text-xl font-extrabold flex items-center gap-2">{p.display_name}
            {p.account_type === 'verified' && <Check className="h-4 w-4 text-brand bg-brand/20 rounded-full p-0.5" />}</h1>
          <div className="text-slate-500">#{p.handle}</div>
          {editing ? (
            <div className="mt-3">
              <textarea value={bio} onChange={e => setBio(e.target.value)} rows={2} maxLength={150}
                className="w-full bg-ink border border-edge rounded-xl px-3 py-2 outline-none focus:border-brand" />
              <div className="flex gap-2 mt-2"><button onClick={saveBio} className="px-4 py-1.5 rounded-lg bg-brand font-medium">Save</button>
                <button onClick={() => setEditing(false)} className="px-4 py-1.5 rounded-lg border border-edge">Cancel</button></div>
            </div>
          ) : p.bio && <p className="mt-2 text-slate-200">{p.bio}</p>}
          {p.links?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {p.links.map((l: string) => <span key={l} className="flex items-center gap-1 text-brand"><LinkIcon className="h-3.5 w-3.5" />{l}</span>)}
            </div>
          )}
          {p.is_self && <div className="mt-2 text-sm text-slate-500">{p.followers_count} follower{p.followers_count === 1 ? '' : 's'} · <span className="text-slate-600">(private — only you see this)</span></div>}
        </div>
      </div>

      <div className="mt-4 border-t border-edge px-4 py-3 font-semibold text-slate-300">Media</div>
      <div className="p-4 space-y-4">
        {posts.length === 0 ? <p className="text-center text-slate-500 py-8">No posts you can see here.</p>
          : posts.map(post => <PostCard key={post.id} post={post} onDelete={p.is_self ? async (id: string) => { await api.deletePost(id); setPosts(x => x.filter(y => y.id !== id)) } : undefined} />)}
      </div>
    </div>
  )
}
