import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Avatar } from '../lib/ui'
import PostCard from '../components/PostCard'
import { useAuth } from '../lib/auth'
import { ArrowLeft, MoreHorizontal, ShoppingBag, Lock, Loader2, Check, Link as LinkIcon } from 'lucide-react'

const TABS = ['media', 'wall', 'audio'] as const
type Tab = typeof TABS[number]

export default function Profile() {
  const { handle } = useParams()
  const nav = useNavigate()
  const { refresh } = useAuth()
  const [p, setP] = useState<any>(null)
  const [posts, setPosts] = useState<any[]>([])
  const [tab, setTab] = useState<Tab>('media')
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

  const doFollow = async () => { p.follow_status ? await api.unfollow(p.handle) : await api.follow(p.handle); load() }
  const invite = async () => { await api.inviteInner(p.handle); load() }
  const saveBio = async () => { await api.updateProfile({ bio }); setEditing(false); await refresh(); load() }
  const del = async (id: string) => { await api.deletePost(id); setPosts(x => x.filter(y => y.id !== id)) }

  if (loading) return <div className="py-24 grid place-items-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
  if (!p) return <div className="py-24 text-center text-slate-500">User not found.</div>

  const media = posts.filter(x => x.media_url && x.media_type !== 'audio')
  const wall = posts.filter(x => !x.media_url)
  const audio = posts.filter(x => x.media_type === 'audio')
  const current = tab === 'media' ? media : tab === 'wall' ? wall : audio

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-ink/80 backdrop-blur border-b border-edge h-14 flex items-center justify-between px-4">
        <button onClick={() => nav(-1)} className="flex items-center gap-2 text-slate-300 hover:text-white">
          <ArrowLeft className="h-5 w-5" /> <span className="text-lg">Feed</span>
        </button>
        <button onClick={() => p.is_self && setEditing(e => !e)} className="h-9 w-9 grid place-items-center rounded-lg hover:bg-white/10 text-slate-300">
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      {/* Centered header */}
      <div className="max-w-xl mx-auto px-6 pt-8 flex flex-col items-center text-center">
        <div className="ring-2 ring-edge rounded-full p-1">
          <Avatar id={p.id} name={p.display_name} url={p.avatar_url} size={128} />
        </div>
        <h1 className="mt-5 text-3xl sm:text-4xl font-extrabold flex items-center gap-2">
          #{p.handle}
          {p.account_type === 'verified' && <Check className="h-5 w-5 text-brand bg-brand/20 rounded-full p-0.5" />}
        </h1>
        <div className="mt-1 text-lg text-slate-400">{p.display_name}</div>

        <div className="mt-4 flex items-center gap-2 text-slate-500 uppercase tracking-wide text-sm">
          <ShoppingBag className="h-4 w-4" /> Shop · Coming soon
        </div>

        {p.bio && !editing && <p className="mt-4 text-slate-200 max-w-md">{p.bio}</p>}
        {p.links?.length > 0 && !editing && (
          <div className="mt-2 flex flex-wrap justify-center gap-3 text-sm">
            {p.links.map((l: string) => <span key={l} className="flex items-center gap-1 text-brand"><LinkIcon className="h-3.5 w-3.5" />{l}</span>)}
          </div>
        )}
        {p.is_self && !editing && (
          <div className="mt-2 text-sm text-slate-500">{p.followers_count} follower{p.followers_count === 1 ? '' : 's'} · <span className="text-slate-600">private</span></div>
        )}

        {/* Edit (own) */}
        {editing && p.is_self && (
          <div className="mt-4 w-full max-w-md">
            <textarea value={bio} onChange={e => setBio(e.target.value)} rows={2} maxLength={150}
              placeholder="Add a bio…" className="w-full bg-ink border border-edge rounded-xl px-3 py-2 outline-none focus:border-brand text-left" />
            <div className="flex justify-center gap-2 mt-2">
              <button onClick={saveBio} className="px-5 py-2 rounded-full bg-brand font-medium">Save</button>
              <button onClick={() => setEditing(false)} className="px-5 py-2 rounded-full border border-edge">Cancel</button>
            </div>
          </div>
        )}

        {/* Action pills */}
        {!editing && (
          <div className="mt-6 flex flex-col items-center gap-3 w-full">
            {p.is_self ? (
              <button onClick={() => setEditing(true)} className="px-8 py-2.5 rounded-full border border-edge font-medium hover:bg-white/5">Edit profile</button>
            ) : (
              <>
                <div className="flex items-center justify-center gap-3">
                  <button onClick={doFollow}
                    className={`px-8 py-2.5 rounded-full font-semibold min-w-[140px] ${p.follow_status === 'approved' ? 'border border-edge' : p.follow_status === 'pending' ? 'border border-amber-500/40 text-amber-300' : 'bg-gradient-to-r from-brand to-violet-600'}`}>
                    {p.follow_status === 'approved' ? 'Following' : p.follow_status === 'pending' ? 'Requested' : 'Follow'}
                  </button>
                  <button onClick={() => p.can_dm ? nav(`/messages/${p.handle}`) : alert('DMs are tier-gated — you need to be a Follower (with DMs on) or in their Inner Circle.')}
                    className="px-8 py-2.5 rounded-full border border-edge font-semibold min-w-[140px] hover:bg-white/5">Message</button>
                </div>
                <button onClick={invite} disabled={p.inner_status === 'accepted'}
                  className="px-5 py-2 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 text-sm flex items-center gap-1.5 hover:bg-violet-500/20 disabled:opacity-50">
                  <Lock className="h-4 w-4" />
                  {p.inner_status === 'accepted' ? 'In your Inner Circle' : p.inner_status === 'pending' ? 'Invite sent' : 'Invite to Inner Circle'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mt-8 border-b border-edge">
        <div className="max-w-xl mx-auto flex items-center justify-center gap-10">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`relative py-3 uppercase tracking-wide font-semibold text-sm transition ${tab === t ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>
              {t}
              {tab === t && <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-gradient-to-r from-brand to-violet-500 rounded-full" />}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
        {current.length === 0
          ? <p className="text-center text-slate-500 py-14">No {tab} posts yet.</p>
          : current.map(post => <PostCard key={post.id} post={post} onDelete={p.is_self ? del : undefined} />)}
      </div>
    </div>
  )
}
