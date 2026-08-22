import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { TIER, TierKey } from '../lib/ui'
import PostCard from '../components/PostCard'
import { Image as ImageIcon, Loader2, X, LayoutGrid, AlignLeft } from 'lucide-react'

function Composer({ onPosted }: { onPosted: () => void }) {
  const [tier, setTier] = useState<TierKey>('public')
  const [text, setText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [media, setMedia] = useState<{ url: string; type: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const addTag = (v: string) => {
    const t = v.replace(/[^a-z0-9]/gi, '').toLowerCase()
    if (t && tags.length < 10 && !tags.includes(t)) setTags([...tags, t])
    setTagInput('')
  }
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    setUploading(true)
    try { const r = await api.upload(f); setMedia({ url: r.signed_url, type: r.media_type }) }
    catch { alert('Upload failed') } finally { setUploading(false) }
  }
  const submit = async () => {
    if (!text.trim() && !media) return
    setBusy(true)
    try {
      await api.createPost({ tier, text, media_url: media?.url, media_type: media?.type, tags })
      setText(''); setTags([]); setMedia(null); onPosted()
    } catch (e: any) { alert(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="bg-panel border border-edge rounded-2xl p-4">
      <div className="flex gap-2 mb-3">
        {(Object.keys(TIER) as TierKey[]).map(k => {
          const T = TIER[k], I = T.icon, active = tier === k
          return (
            <button key={k} onClick={() => setTier(k)}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition ${active ? `${T.bg} ${T.text} ${T.ring}` : 'border-edge text-slate-400 hover:text-white'}`}>
              <I className="h-3.5 w-3.5" />{T.label}
            </button>
          )
        })}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
        placeholder="What's happening in your clubhouse?"
        className="w-full bg-ink border border-edge rounded-xl px-4 py-3 outline-none focus:border-brand resize-none" />
      {media && (
        <div className="relative mt-2 inline-block">
          {media.type === 'video' ? <video src={media.url} className="rounded-xl max-h-48" />
            : <img src={media.url} className="rounded-xl max-h-48" />}
          <button onClick={() => setMedia(null)} className="absolute top-1 right-1 h-7 w-7 grid place-items-center rounded-full bg-black/70"><X className="h-4 w-4" /></button>
        </div>
      )}
      {tier !== 'inner' && (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1.5 items-center">
            {tags.map(t => (
              <span key={t} className="text-xs text-brand bg-brand/10 px-2 py-1 rounded-full flex items-center gap-1">
                #{t}<button onClick={() => setTags(tags.filter(x => x !== t))}><X className="h-3 w-3" /></button>
              </span>
            ))}
            <input value={tagInput}
              onChange={e => { const v = e.target.value; if (v.endsWith(' ') || v.endsWith(',')) addTag(v); else setTagInput(v) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput) } }}
              placeholder={tags.length ? '' : 'add #tags…'} className="bg-transparent text-sm outline-none flex-1 min-w-[80px] py-1" />
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 mt-3">
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onFile} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="h-10 w-10 grid place-items-center rounded-xl bg-white/5 border border-edge hover:bg-white/10">
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
        </button>
        <button onClick={submit} disabled={busy || (!text.trim() && !media)}
          className="ml-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand to-violet-600 font-semibold disabled:opacity-50">
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}

export default function Feed() {
  const [scope, setScope] = useState('general')
  const [view, setView] = useState<'words' | 'gallery'>('words')
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => { setLoading(true); try { setPosts(await api.feed(scope)) } finally { setLoading(false) } }
  useEffect(() => { load() }, [scope])

  const del = async (id: string) => { await api.deletePost(id); setPosts(p => p.filter(x => x.id !== id)) }
  const gallery = posts.filter(p => p.media_url)

  return (
    <div>
      <div className="sticky top-0 z-30 bg-ink/80 backdrop-blur border-b border-edge px-4 py-3 flex items-center gap-3">
        <h1 className="text-xl font-extrabold">My Feed</h1>
        <div className="ml-auto flex items-center gap-1 bg-panel border border-edge rounded-xl p-1">
          {['general', 'followers'].map(s => (
            <button key={s} onClick={() => setScope(s)} className={`text-sm px-3 py-1 rounded-lg capitalize ${scope === s ? 'bg-brand text-white' : 'text-slate-400'}`}>{s}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-panel border border-edge rounded-xl p-1">
          <button onClick={() => setView('words')} className={`h-8 w-8 grid place-items-center rounded-lg ${view === 'words' ? 'bg-brand text-white' : 'text-slate-400'}`}><AlignLeft className="h-4 w-4" /></button>
          <button onClick={() => setView('gallery')} className={`h-8 w-8 grid place-items-center rounded-lg ${view === 'gallery' ? 'bg-brand text-white' : 'text-slate-400'}`}><LayoutGrid className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <Composer onPosted={load} />
        {loading ? <div className="py-16 grid place-items-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
          : view === 'gallery' ? (
            <div className="grid grid-cols-3 gap-1.5">
              {gallery.map(p => <img key={p.id} src={p.media_url} className="aspect-square object-cover rounded-lg" />)}
              {gallery.length === 0 && <p className="col-span-3 text-center text-slate-500 py-10">No media posts yet.</p>}
            </div>
          ) : posts.length === 0 ? <p className="text-center text-slate-500 py-10">Nothing here yet. Make the first post!</p>
            : posts.map(p => <PostCard key={p.id} post={p} onDelete={del} />)}
      </div>
    </div>
  )
}
