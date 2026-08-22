import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, getToken, wsDmUrl } from '../lib/api'
import { Avatar } from '../lib/ui'
import { useAuth } from '../lib/auth'
import CallModal from '../components/CallModal'
import { Send, Phone, Video, Lock, ArrowLeft, Loader2 } from 'lucide-react'

export default function Messages() {
  const { handle } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const [threads, setThreads] = useState<any[]>([])
  const [thread, setThread] = useState<any>(null)
  const [msgs, setMsgs] = useState<any[]>([])
  const [text, setText] = useState('')
  const [call, setCall] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => { api.dmThreads().then(setThreads).catch(() => {}) }, [handle])

  useEffect(() => {
    if (!handle) { setThread(null); return }
    let stop = false; seen.current = new Set(); setLoading(true)
    ;(async () => {
      const h = await api.dmHistory(handle)
      if (stop) return
      setThread(h); h.messages.forEach((m: any) => seen.current.add(m.id)); setMsgs(h.messages); setLoading(false)
    })()
    const connect = () => {
      const t = getToken(); if (!t) return
      const ws = new WebSocket(wsDmUrl(handle, t)); wsRef.current = ws
      ws.onmessage = (ev) => {
        try { const d = JSON.parse(ev.data)
          if (d.type === 'dm' && !seen.current.has(d.message.id)) {
            seen.current.add(d.message.id)
            setMsgs(p => [...p, { ...d.message, mine: d.message.sender_id === user?.id }])
          } } catch {}
      }
      ws.onclose = () => { if (!stop) setTimeout(connect, 1500) }
    }
    connect()
    return () => { stop = true; wsRef.current?.close() }
  }, [handle])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); const body = text.trim(); if (!body || !handle) return
    setText('')
    try { const m = await api.dmSend(handle, body); if (!seen.current.has(m.id)) { seen.current.add(m.id); setMsgs(p => [...p, m]) } }
    catch (err: any) { alert(err.message); setText(body) }
  }

  const callRoom = handle && user ? `dm-${[user.handle, handle].sort().join('-')}` : ''

  return (
    <div className="flex h-screen">
      {call && <CallModal room={call} onClose={() => setCall(null)} />}
      {/* Threads list */}
      <div className={`${handle ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-80 shrink-0 border-r border-edge`}>
        <div className="px-4 py-3 border-b border-edge font-extrabold text-xl">Messages</div>
        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 && <p className="text-slate-500 text-sm p-4">No conversations yet. Open someone's profile and start a chat (DMs are tier-gated).</p>}
          {threads.map(t => (
            <button key={t.user.id} onClick={() => nav(`/messages/${t.user.handle}`)}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left ${handle === t.user.handle ? 'bg-white/5' : ''}`}>
              <Avatar id={t.user.id} name={t.user.display_name} url={t.user.avatar_url} />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{t.user.display_name}</div>
                <div className="text-sm text-slate-500 truncate">{t.mine ? 'You: ' : ''}{t.last}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className={`${handle ? 'flex' : 'hidden lg:flex'} flex-col flex-1 min-w-0`}>
        {!handle ? <div className="flex-1 grid place-items-center text-slate-500">Select a conversation</div>
          : loading ? <div className="flex-1 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
          : thread && (
            <>
              <div className="h-16 shrink-0 border-b border-edge px-4 flex items-center gap-3">
                <button onClick={() => nav('/messages')} className="lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
                <Avatar id={thread.peer.id} name={thread.peer.display_name} url={thread.peer.avatar_url} size={38} />
                <div className="flex-1 min-w-0"><div className="font-semibold truncate">{thread.peer.display_name}</div><div className="text-xs text-slate-500">#{thread.peer.handle}</div></div>
                <div className="flex items-center gap-1 text-xs text-emerald-400 mr-2"><Lock className="h-3 w-3" />Encrypted</div>
                <button onClick={() => setCall(callRoom)} className="h-9 w-9 grid place-items-center rounded-lg hover:bg-white/10"><Phone className="h-4 w-4" /></button>
                <button onClick={() => setCall(callRoom)} className="h-9 w-9 grid place-items-center rounded-lg hover:bg-white/10"><Video className="h-4 w-4" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {msgs.map(m => (
                  <div key={m.id} className={`flex ${m.mine ? 'justify-end' : ''}`}>
                    <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${m.mine ? 'bg-gradient-to-br from-brand to-violet-600 text-white rounded-br-sm' : 'bg-white/5 border border-edge rounded-bl-sm'}`}>{m.text}</div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {thread.can_dm ? (
                <form onSubmit={send} className="p-3 border-t border-edge flex gap-2">
                  <input value={text} onChange={e => setText(e.target.value)} placeholder="Message (encrypted)…"
                    className="flex-1 bg-ink border border-edge rounded-xl px-4 py-3 outline-none focus:border-brand" />
                  <button className="h-11 w-11 grid place-items-center rounded-xl bg-gradient-to-r from-brand to-violet-600"><Send className="h-5 w-5" /></button>
                </form>
              ) : <div className="p-4 border-t border-edge text-center text-sm text-slate-500">You can't DM this person. DMs open only for your Inner Circle or Followers who allow it.</div>}
            </>
          )}
      </div>
    </div>
  )
}
