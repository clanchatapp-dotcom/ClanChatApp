import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { api, getToken, wsUrl } from '../lib/api'
import {
  MessageCircle, Send, Plus, Hash, LogOut, ImagePlus, X, Copy, Users, Loader2,
} from 'lucide-react'

type Clan = { id: string; name: string; description: string; code: string; member_count: number; is_member: boolean }
type Msg = { id: string; clan_id: string; user_id: string; user_name: string; text: string; media_url?: string | null; created_at: string }

const COLORS = ['from-indigo-400 to-blue-500', 'from-fuchsia-400 to-pink-500', 'from-emerald-400 to-teal-500', 'from-amber-400 to-orange-500', 'from-violet-400 to-purple-500', 'from-rose-400 to-red-500']
function colorFor(id: string) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length] }
function initials(n: string) { return (n || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase() }
function timeOf(iso: string) { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

export default function Chat() {
  const { user, logout } = useAuth()
  const [clans, setClans] = useState<Clan[]>([])
  const [active, setActive] = useState<Clan | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [uploading, setUploading] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const seen = useRef<Set<string>>(new Set())

  const loadClans = async () => {
    const cs = await api.listClans()
    setClans(cs)
    setActive(prev => prev ? cs.find((c: Clan) => c.id === prev.id) || prev : cs[0] || null)
  }

  useEffect(() => { loadClans() }, [])

  // load messages + open websocket when active clan changes
  useEffect(() => {
    if (!active) return
    let stop = false
    seen.current = new Set()
    ;(async () => {
      const ms: Msg[] = await api.getMessages(active.id)
      if (stop) return
      ms.forEach(m => seen.current.add(m.id))
      setMessages(ms)
    })()

    const connect = () => {
      const token = getToken(); if (!token) return
      const ws = new WebSocket(wsUrl(active.id, token))
      wsRef.current = ws
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (data.type === 'message' && !seen.current.has(data.message.id)) {
            seen.current.add(data.message.id)
            setMessages(prev => [...prev, data.message])
          }
        } catch {}
      }
      ws.onclose = () => { if (!stop) setTimeout(connect, 1500) }
    }
    connect()

    // polling fallback
    const poll = setInterval(async () => {
      try {
        const ms: Msg[] = await api.getMessages(active.id)
        const fresh = ms.filter(m => !seen.current.has(m.id))
        if (fresh.length) { fresh.forEach(m => seen.current.add(m.id)); setMessages(prev => [...prev, ...fresh]) }
      } catch {}
    }, 5000)

    return () => { stop = true; clearInterval(poll); wsRef.current?.close() }
  }, [active?.id])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!active || (!text.trim() && !sending)) return
    const body = text.trim(); if (!body) return
    setText(''); setSending(true)
    try {
      const m = await api.sendMessage(active.id, body)
      if (!seen.current.has(m.id)) { seen.current.add(m.id); setMessages(prev => [...prev, m]) }
    } catch (err) { setText(body) } finally { setSending(false) }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f || !active) return
    setUploading(true)
    try {
      const { signed_url } = await api.upload(f)
      const m = await api.sendMessage(active.id, '', signed_url)
      if (!seen.current.has(m.id)) { seen.current.add(m.id); setMessages(prev => [...prev, m]) }
    } catch (err) { alert('Upload failed') } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const createClan = async (e: React.FormEvent) => {
    e.preventDefault(); if (!newName.trim()) return
    const c = await api.createClan(newName.trim())
    setNewName(''); setShowCreate(false)
    await loadClans(); setActive(c)
  }
  const doJoin = async (e: React.FormEvent) => {
    e.preventDefault(); if (!joinCode.trim()) return
    try { const c = await api.joinByCode(joinCode.trim()); setJoinCode(''); setShowCreate(false); await loadClans(); setActive(c) }
    catch { alert('No clan with that code') }
  }

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 bg-panel/60 border-r border-edge flex flex-col">
        <div className="p-4 flex items-center gap-2 border-b border-edge">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 grid place-items-center"><MessageCircle className="h-5 w-5 text-white" /></div>
          <span className="font-extrabold text-lg">ClanChat</span>
        </div>
        <div className="px-3 pt-3 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Clans</span>
          <button onClick={() => setShowCreate(true)} className="h-7 w-7 grid place-items-center rounded-lg bg-white/5 hover:bg-white/10 border border-edge"><Plus className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {clans.map(c => (
            <button key={c.id} onClick={() => setActive(c)}
              className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 transition ${active?.id === c.id ? 'bg-indigo-500/20 border border-indigo-400/40' : 'hover:bg-white/5 border border-transparent'}`}>
              <div className="h-8 w-8 rounded-lg bg-white/5 grid place-items-center text-slate-300"><Hash className="h-4 w-4" /></div>
              <div className="min-w-0">
                <div className="font-medium truncate">{c.name}</div>
                <div className="text-xs text-slate-500 flex items-center gap-1"><Users className="h-3 w-3" />{c.member_count}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-edge flex items-center gap-3">
          <div className={`h-9 w-9 rounded-full bg-gradient-to-br ${colorFor(user?.id || '')} grid place-items-center text-sm font-bold text-white`}>{initials(user?.name || '')}</div>
          <div className="min-w-0 flex-1"><div className="font-medium truncate">{user?.name}</div><div className="text-xs text-slate-500 truncate">{user?.email}</div></div>
          <button onClick={logout} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-white/10 text-slate-400"><LogOut className="h-4 w-4" /></button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {active ? (
          <>
            <header className="h-16 shrink-0 border-b border-edge px-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Hash className="h-5 w-5 text-slate-400" />
                <div>
                  <div className="font-bold">{active.name}</div>
                  <div className="text-xs text-slate-500">{active.description || 'No description'}</div>
                </div>
              </div>
              <button onClick={() => { navigator.clipboard?.writeText(active.code); }}
                className="flex items-center gap-2 text-sm bg-white/5 border border-edge rounded-lg px-3 py-1.5 hover:bg-white/10">
                <Copy className="h-3.5 w-3.5" /> Code: <span className="font-mono font-semibold">{active.code}</span>
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="h-full grid place-items-center text-slate-500">
                  <div className="text-center"><MessageCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />No messages yet. Say hi 👋</div>
                </div>
              )}
              {messages.map((m, i) => {
                const mine = m.user_id === user?.id
                const prev = messages[i - 1]
                const grouped = prev && prev.user_id === m.user_id
                return (
                  <div key={m.id} className={`flex gap-3 animate-pop ${mine ? 'flex-row-reverse' : ''}`}>
                    <div className={`h-9 w-9 rounded-full shrink-0 bg-gradient-to-br ${colorFor(m.user_id)} grid place-items-center text-xs font-bold text-white ${grouped ? 'opacity-0' : ''}`}>{initials(m.user_name)}</div>
                    <div className={`max-w-[70%] ${mine ? 'items-end text-right' : ''} flex flex-col`}>
                      {!grouped && <div className={`text-xs text-slate-500 mb-1 ${mine ? 'text-right' : ''}`}>{m.user_name} · {timeOf(m.created_at)}</div>}
                      <div className={`rounded-2xl px-4 py-2.5 break-words ${mine ? 'bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white rounded-tr-sm' : 'bg-white/5 border border-edge rounded-tl-sm'}`}>
                        {m.media_url ? <img src={m.media_url} alt="shared" className="rounded-lg max-h-72 object-cover" /> : m.text}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={endRef} />
            </div>

            <form onSubmit={send} className="p-4 border-t border-edge flex items-center gap-2">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                className="h-11 w-11 shrink-0 grid place-items-center rounded-xl bg-white/5 border border-edge hover:bg-white/10 disabled:opacity-50">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
              </button>
              <input value={text} onChange={e => setText(e.target.value)} placeholder={`Message #${active.name}`}
                className="flex-1 bg-ink border border-edge rounded-xl px-4 py-3 outline-none focus:border-indigo-400 transition" />
              <button type="submit" disabled={sending || !text.trim()}
                className="h-11 px-5 shrink-0 grid place-items-center rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 font-semibold disabled:opacity-50">
                <Send className="h-5 w-5" />
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 grid place-items-center text-slate-500">Select a clan to start chatting</div>
        )}
      </main>

      {/* Create / Join modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 grid place-items-center p-6 z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-panel border border-edge rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-lg">New clan</h3><button onClick={() => setShowCreate(false)}><X className="h-5 w-5 text-slate-400" /></button></div>
            <form onSubmit={createClan} className="space-y-3">
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Clan name"
                className="w-full bg-ink border border-edge rounded-xl px-4 py-3 outline-none focus:border-indigo-400" />
              <button className="w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 font-semibold rounded-xl py-3">Create clan</button>
            </form>
            <div className="flex items-center gap-3 my-5 text-slate-500 text-xs"><div className="h-px bg-edge flex-1" />OR JOIN<div className="h-px bg-edge flex-1" /></div>
            <form onSubmit={doJoin} className="space-y-3">
              <input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Enter clan code"
                className="w-full bg-ink border border-edge rounded-xl px-4 py-3 outline-none focus:border-indigo-400 uppercase font-mono" />
              <button className="w-full bg-white/5 border border-edge font-semibold rounded-xl py-3 hover:bg-white/10">Join with code</button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
