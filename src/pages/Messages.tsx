import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, getToken, wsDmUrl } from '../lib/api'
import { Avatar } from '../lib/ui'
import { useAuth } from '../lib/auth'
import CallModal from '../components/CallModal'
import { Send, Phone, Video, Lock, ArrowLeft, Loader2, Bookmark, Trash2, Pin, Mic, Square } from 'lucide-react'

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
          }
          if (d.type === 'dm_deleted') setMsgs(p => p.map(m => m.id === d.id ? { ...m, deleted: true, media_url: null, text: 'This message was deleted' } : m))
          if (d.type === 'dm_pin') setMsgs(p => p.map(m => m.id === d.id ? { ...m, pinned: d.pinned } : m)) } catch {}
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

  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recStart = useRef<number>(0)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream); recRef.current = mr; chunksRef.current = []; recStart.current = Date.now()
      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const dur = Math.round((Date.now() - recStart.current) / 1000)
        if (dur < 1 || !handle) return
        setBusy(true)
        try {
          const { signed_url } = await api.upload(new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' }))
          const m = await api.sendDmMedia(handle, signed_url, 'audio', dur)
          if (!seen.current.has(m.id)) { seen.current.add(m.id); setMsgs(p => [...p, m]) }
        } catch (e: any) { alert(e.message || 'Could not send voice message') }
        setBusy(false)
      }
      mr.start(); setRecording(true)
    } catch { alert('Microphone permission needed to record a voice message.') }
  }
  const stopRec = () => { recRef.current?.stop(); setRecording(false) }

  const togglePin = async (id: string) => {
    try { const r = await api.pinDm(handle!, id); setMsgs(x => x.map(m => m.id === id ? { ...m, pinned: r.pinned } : m)) } catch {}
  }

  const callRoom = handle && user ? `dm-${[user.handle, handle].sort().join('-')}` : ''
  const isSelf = !!handle && handle === user?.handle
  const selfThread = threads.find(t => t.user.handle === user?.handle)
  const otherThreads = threads.filter(t => t.user.handle !== user?.handle)

  return (
    <div className="flex h-screen">
      {call && <CallModal room={call} onClose={() => setCall(null)} />}
      {/* Threads list */}
      <div className={`${handle ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-80 shrink-0 border-r border-edge`}>
        <div className="px-4 py-3 border-b border-edge font-extrabold text-xl">Messages</div>
        <div className="flex-1 overflow-y-auto">
          {/* Me, Myself & I — Saved Messages (always pinned at top) */}
          <button onClick={() => nav(`/messages/${user?.handle}`)}
            className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left border-b border-edge/60 ${isSelf ? 'bg-white/5' : ''}`}>
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-brand to-violet-600 grid place-items-center shrink-0"><Bookmark className="h-5 w-5 text-white" /></div>
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">Me, Myself &amp; I</div>
              <div className="text-sm text-slate-500 truncate">{selfThread ? `${selfThread.mine ? 'You: ' : ''}${selfThread.last}` : 'Notes, links & things to remember'}</div>
            </div>
          </button>
          {otherThreads.length === 0 && <p className="text-slate-500 text-sm p-4">No conversations yet. Open someone's profile and start a chat (DMs are tier-gated).</p>}
          {otherThreads.map(t => (
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
                {isSelf
                  ? <div className="h-[38px] w-[38px] rounded-full bg-gradient-to-br from-brand to-violet-600 grid place-items-center shrink-0"><Bookmark className="h-5 w-5 text-white" /></div>
                  : <Avatar id={thread.peer.id} name={thread.peer.display_name} url={thread.peer.avatar_url} size={38} />}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{isSelf ? 'Me, Myself & I' : thread.peer.display_name}</div>
                  <div className="text-xs text-slate-500 truncate">{isSelf ? 'Your private space · only you can see this' : `#${thread.peer.handle}`}</div>
                </div>
                <div className="flex items-center gap-1 text-xs text-emerald-400 mr-2"><Lock className="h-3 w-3" />Encrypted</div>
                {!isSelf && <>
                  <button onClick={() => setCall(callRoom)} className="h-9 w-9 grid place-items-center rounded-lg hover:bg-white/10"><Phone className="h-4 w-4" /></button>
                  <button onClick={() => setCall(callRoom)} className="h-9 w-9 grid place-items-center rounded-lg hover:bg-white/10"><Video className="h-4 w-4" /></button>
                </>}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {msgs.some(m => m.pinned && !m.deleted) && (
                  <div className="sticky top-0 z-10 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
                    <Pin className="h-3.5 w-3.5" /> {msgs.filter(m => m.pinned && !m.deleted).length} pinned message(s)
                  </div>
                )}
                {isSelf && msgs.length === 0 && (
                  <div className="text-center text-slate-500 py-10 px-6">
                    <Bookmark className="h-8 w-8 mx-auto mb-3 text-brand" />
                    <div className="font-medium text-slate-300">Me, Myself &amp; I</div>
                    <p className="text-sm mt-1">Your own private, encrypted space. Jot notes, save links, or drop reminders — only you can see them.</p>
                  </div>
                )}
                {msgs.map(m => (
                  <div key={m.id} className={`group flex items-center gap-2 ${m.mine ? 'justify-end' : ''}`}>
                    {m.mine && !m.deleted && (
                      <button onClick={async () => { try { await api.deleteDm(handle!, m.id); setMsgs(x => x.map(y => y.id === m.id ? { ...y, deleted: true, media_url: null, text: 'This message was deleted' } : y)) } catch {} }}
                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 transition"><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                    {!m.deleted && (
                      <button onClick={() => togglePin(m.id)} title={m.pinned ? 'Unpin' : 'Pin'}
                        className={`opacity-0 group-hover:opacity-100 transition ${m.pinned ? 'text-amber-400 opacity-100' : 'text-slate-500 hover:text-amber-400'}`}><Pin className="h-3.5 w-3.5" /></button>
                    )}
                    <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${m.deleted ? 'bg-white/5 border border-edge text-slate-500 italic' : m.mine ? 'bg-gradient-to-br from-brand to-violet-600 text-white rounded-br-sm' : 'bg-white/5 border border-edge rounded-bl-sm'}`}>
                      {m.pinned && !m.deleted && <Pin className="h-3 w-3 inline mr-1 opacity-70" />}
                      {m.media_type === 'audio' && m.media_url
                        ? <audio src={m.media_url} controls className="max-w-[220px] h-9" />
                        : m.media_url
                          ? <img src={m.media_url} className="rounded-lg max-h-64" />
                          : m.text}
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {thread.can_dm ? (
                <form onSubmit={send} className="p-3 border-t border-edge flex gap-2 items-center">
                  <input value={text} onChange={e => setText(e.target.value)} placeholder={recording ? 'Recording…' : 'Message (encrypted)…'} disabled={recording}
                    className="flex-1 bg-ink border border-edge rounded-xl px-4 py-3 outline-none focus:border-brand disabled:opacity-60" />
                  <button type="button" onClick={recording ? stopRec : startRec} disabled={busy}
                    className={`h-11 w-11 grid place-items-center rounded-xl shrink-0 ${recording ? 'bg-rose-600 animate-pulse' : 'bg-white/10 hover:bg-white/20'}`}>
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : recording ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
                  </button>
                  <button className="h-11 w-11 grid place-items-center rounded-xl bg-gradient-to-r from-brand to-violet-600 shrink-0"><Send className="h-5 w-5" /></button>
                </form>
              ) : <div className="p-4 border-t border-edge text-center text-sm text-slate-500">You can't DM this person. DMs open only for your Inner Circle or Followers who allow it.</div>}
            </>
          )}
      </div>
    </div>
  )
}
