import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, getToken, wsDmUrl } from '../lib/api'
import { Avatar, Linkify } from '../lib/ui'
import { useAuth } from '../lib/auth'
import CallModal from '../components/CallModal'
import { secureOn, secureOff, screenshotProtectionAvailable } from '../lib/privacyScreen'
import { Send, Phone, Video, Lock, ArrowLeft, Loader2, Bookmark, Trash2, Pin, Mic, Square, Users, ChevronRight, Eye, Flame, Image as ImageIcon, X } from 'lucide-react'

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

  // Screenshot protection: block screenshots/recording while a DM thread is open (Android, OS-enforced).
  useEffect(() => {
    if (!handle) return
    secureOn()
    return () => { secureOff() }
  }, [handle])

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
          if (d.type === 'dm_pin') setMsgs(p => p.map(m => m.id === d.id ? { ...m, pinned: d.pinned } : m))
          if (d.type === 'dm_viewed') setMsgs(p => p.map(m => m.id === d.id ? { ...m, view_once_viewed: true } : m))
          if (d.type === 'call_declined') { setCall(null); alert(`@${d.from} declined the call`) } } catch {}
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

  const [gifOpen, setGifOpen] = useState(false)
  const [gifs, setGifs] = useState<any[]>([])
  const [gifQ, setGifQ] = useState('')
  const [viewOnce, setViewOnce] = useState(false)
  const [noSave, setNoSave] = useState(false)
  // Media selected but not yet sent — the "final step" sheet lets the user pick
  // one-time / no-save options before it actually goes out (keeps composer clean).
  const [pending, setPending] = useState<{ url: string; media_type: string } | null>(null)
  const [viewer, setViewer] = useState<{ url: string; type: string } | null>(null)
  const [uploadingImg, setUploadingImg] = useState(false)
  const imgRef = useRef<HTMLInputElement | null>(null)
  const openGif = async () => { setGifOpen(o => !o); if (!gifOpen && gifs.length === 0) { try { setGifs(await api.giphySearch('')) } catch {} } }
  const searchGifs = async (query: string) => { setGifQ(query); try { setGifs(await api.giphySearch(query)) } catch {} }
  // Picking a GIF no longer sends immediately — it opens the media-options sheet.
  const sendGif = (url: string) => {
    if (!handle) return
    setGifOpen(false); setViewOnce(false); setNoSave(false)
    setPending({ url, media_type: 'image' })
  }
  // Picking a photo uploads it, then opens the media-options sheet (does NOT send yet).
  const onImgPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f || !handle) return
    setUploadingImg(true)
    try {
      const { signed_url } = await api.upload(f)
      setViewOnce(false); setNoSave(false)
      setPending({ url: signed_url, media_type: 'image' })
    } catch (err: any) { alert(err.message || 'Could not upload photo') }
    setUploadingImg(false); if (imgRef.current) imgRef.current.value = ''
  }
  // Final step: actually send the pending media with the chosen privacy options.
  const confirmSendMedia = async () => {
    if (!handle || !pending) return
    setBusy(true)
    try {
      const m = await api.sendDmMedia(handle, pending.url, pending.media_type, undefined, undefined, viewOnce, !noSave)
      if (!seen.current.has(m.id)) { seen.current.add(m.id); setMsgs(p => [...p, m]) }
      setPending(null); setViewOnce(false); setNoSave(false)
    } catch (e: any) { alert(e.message || 'Could not send media') }
    setBusy(false)
  }
  const openViewOnce = async (id: string) => {
    if (!handle) return
    try {
      const r = await api.viewOnceDm(handle, id)
      setViewer({ url: r.media_url, type: r.media_type || 'image' })
      setMsgs(p => p.map(m => m.id === id ? { ...m, view_once_viewed: true } : m))
    } catch (e: any) { alert(e.message || 'This media has already been viewed'); setMsgs(p => p.map(m => m.id === id ? { ...m, view_once_viewed: true } : m)) }
  }

  // Block screenshots while a one-time media viewer is open (Android, OS-enforced).
  useEffect(() => {
    if (viewer) { secureOn(); return () => { secureOff() } }
  }, [viewer])

  const callRoom = handle && user ? `dm-${[user.handle, handle].sort().join('-')}` : ''
  const isSelf = !!handle && handle === user?.handle

  // Start an outgoing call: ring the peer (their app shows an incoming-call screen)
  // then open the LiveKit room on our side.
  const startCall = async (media: 'audio' | 'video') => {
    if (!handle || isSelf || !callRoom) return
    setCall(callRoom)
    try { await api.callRing(handle, callRoom, media) }
    catch (e: any) { setCall(null); alert(e?.message || 'Could not start the call') }
  }

  const selfThread = threads.find(t => t.user.handle === user?.handle)
  const otherThreads = threads.filter(t => t.user.handle !== user?.handle)

  return (
    <div className="flex h-screen">
      {call && <CallModal room={call} peer={handle && handle !== user?.handle ? handle : undefined} onClose={() => setCall(null)} />}
      {/* Final-step media options sheet: pick one-time / no-save before sending. */}
      {pending && (
        <div className="fixed inset-0 z-[72] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => !busy && setPending(null)}>
          <div onClick={e => e.stopPropagation()}
            className="w-full sm:max-w-md bg-panel border-t sm:border border-edge rounded-t-2xl sm:rounded-2xl p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold">Send media</span>
              <button onClick={() => !busy && setPending(null)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-white/10"><X className="h-4 w-4" /></button>
            </div>
            <div className="rounded-xl overflow-hidden bg-black grid place-items-center max-h-64 mb-4">
              <img src={pending.url} alt="preview" className="max-h-64 w-auto object-contain" />
            </div>
            <button type="button" onClick={() => setViewOnce(v => !v)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border mb-2 text-left transition ${viewOnce ? 'border-orange-500/60 bg-orange-500/10' : 'border-edge bg-white/5 hover:bg-white/10'}`}>
              <span className={`h-9 w-9 grid place-items-center rounded-lg shrink-0 ${viewOnce ? 'bg-orange-500 text-white' : 'bg-white/10 text-slate-300'}`}><Flame className="h-5 w-5" /></span>
              <span className="flex-1 min-w-0">
                <span className="block font-medium">One-time view</span>
                <span className="block text-xs text-slate-400">Disappears after they open it once</span>
              </span>
              <span className={`h-6 w-11 rounded-full p-0.5 transition ${viewOnce ? 'bg-orange-500' : 'bg-white/15'}`}>
                <span className={`block h-5 w-5 rounded-full bg-white transition ${viewOnce ? 'translate-x-5' : ''}`} />
              </span>
            </button>
            <button type="button" onClick={() => !viewOnce && setNoSave(v => !v)} disabled={viewOnce}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition ${(noSave || viewOnce) ? 'border-rose-500/60 bg-rose-500/10' : 'border-edge bg-white/5 hover:bg-white/10'} ${viewOnce ? 'opacity-70 cursor-not-allowed' : ''}`}>
              <span className={`h-9 w-9 grid place-items-center rounded-lg shrink-0 ${(noSave || viewOnce) ? 'bg-rose-500 text-white' : 'bg-white/10 text-slate-300'}`}><Lock className="h-5 w-5" /></span>
              <span className="flex-1 min-w-0">
                <span className="block font-medium">Block saving</span>
                <span className="block text-xs text-slate-400">{viewOnce ? 'Always on for one-time media' : 'They can’t save or download it'}</span>
              </span>
              <span className={`h-6 w-11 rounded-full p-0.5 transition ${(noSave || viewOnce) ? 'bg-rose-500' : 'bg-white/15'}`}>
                <span className={`block h-5 w-5 rounded-full bg-white transition ${(noSave || viewOnce) ? 'translate-x-5' : ''}`} />
              </span>
            </button>
            <button type="button" onClick={confirmSendMedia} disabled={busy}
              className="mt-4 w-full py-3 rounded-xl bg-gradient-to-r from-brand to-violet-600 font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />} Send
            </button>
          </div>
        </div>
      )}
      {viewer && (
        <div className="fixed inset-0 z-[70] bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 h-14 border-b border-edge shrink-0">
            <span className="font-semibold flex items-center gap-2 text-orange-300"><Flame className="h-4 w-4" />One-time view{screenshotProtectionAvailable() ? ' · screenshots blocked' : ''}</span>
            <button onClick={() => setViewer(null)} className="h-9 w-9 grid place-items-center rounded-lg hover:bg-white/10"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 min-h-0 grid place-items-center p-4">
            {viewer.type === 'video'
              ? <video src={viewer.url} controls autoPlay className="max-h-full max-w-full rounded-lg" />
              : <img src={viewer.url} className="max-h-full max-w-full rounded-lg object-contain" />}
          </div>
          <div className="text-center text-xs text-slate-500 pb-4 shrink-0">This can only be viewed once. Closing removes it for good.</div>
        </div>
      )}
      {/* Threads list */}
      <div className={`${handle ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-80 shrink-0 border-r border-edge`}>
        <div className="px-4 py-3 border-b border-edge font-extrabold text-xl">Messages</div>
        <button onClick={() => nav('/groups')} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left border-b border-edge/60">
          <div className="h-10 w-10 rounded-full bg-white/5 border border-edge grid place-items-center shrink-0"><Users className="h-5 w-5 text-brand" /></div>
          <div className="min-w-0 flex-1"><div className="font-medium truncate">Groups</div><div className="text-sm text-slate-500 truncate">Private Inner-Circle group chats</div></div>
          <ChevronRight className="h-4 w-4 text-slate-500" />
        </button>
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
              {t.unread > 0 && <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-xs grid place-items-center font-bold">{t.unread > 99 ? '99+' : t.unread}</span>}
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
                <div className="flex items-center gap-1 text-xs text-emerald-400 mr-2">
                  <Lock className="h-3 w-3" />
                  {screenshotProtectionAvailable() ? 'Encrypted · screenshots blocked' : 'Encrypted'}
                </div>
                {!isSelf && (thread.can_call ? <>
                  <button onClick={() => startCall('audio')} title="Voice call" className="h-9 w-9 grid place-items-center rounded-lg hover:bg-white/10"><Phone className="h-4 w-4" /></button>
                  <button onClick={() => startCall('video')} title="Video call" className="h-9 w-9 grid place-items-center rounded-lg hover:bg-white/10"><Video className="h-4 w-4" /></button>
                </> : (
                  <div title="This person has turned off calls from you" className="flex items-center gap-1 text-slate-600">
                    <span className="h-9 w-9 grid place-items-center opacity-40 cursor-not-allowed"><Phone className="h-4 w-4" /></span>
                    <span className="h-9 w-9 grid place-items-center opacity-40 cursor-not-allowed"><Video className="h-4 w-4" /></span>
                  </div>
                ))}
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
                      {m.deleted
                        ? m.text
                        : m.view_once
                          ? (m.mine
                              ? <span className="flex items-center gap-1.5 text-sm opacity-90"><Flame className="h-4 w-4" />{m.view_once_viewed ? 'Opened' : 'One-time photo · sent'}</span>
                              : m.view_once_viewed
                                ? <span className="flex items-center gap-1.5 text-sm text-slate-400"><Flame className="h-4 w-4" />Opened · expired</span>
                                : <button onClick={() => openViewOnce(m.id)} className="flex items-center gap-1.5 text-sm font-medium">
                                    <Eye className="h-4 w-4" />Tap to view once
                                  </button>)
                          : m.media_type === 'audio' && m.media_url
                            ? <audio src={m.media_url} controls className="max-w-[220px] h-9" />
                            : m.media_url
                              ? <img src={m.media_url} draggable={m.allow_save === false ? false : undefined}
                                  onContextMenu={m.allow_save === false ? (e => e.preventDefault()) : undefined}
                                  className={`rounded-lg max-h-64 ${m.allow_save === false ? 'select-none pointer-events-none' : ''}`} />
                              : <Linkify text={m.text} />}
                    </div>
                    {m.allow_save === false && m.media_url && !m.mine && (
                      <div className="flex items-center gap-1 text-[10px] text-rose-300 mt-0.5"><Lock className="h-3 w-3" />Saving blocked</div>
                    )}
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {thread.can_dm ? (
                <div className="border-t border-edge relative">
                  {gifOpen && (
                    <div className="absolute bottom-full left-0 right-0 bg-panel2 border-t border-edge p-3 max-h-72 overflow-y-auto">
                      <input autoFocus value={gifQ} onChange={e => searchGifs(e.target.value)} placeholder="Search GIFs (powered by GIPHY)…"
                        className="w-full bg-ink border border-edge rounded-xl px-3 py-2 text-sm outline-none focus:border-brand mb-2" />
                      <div className="grid grid-cols-3 gap-2">
                        {gifs.map(g => <img key={g.id} src={g.preview} onClick={() => sendGif(g.url)} className="rounded-lg cursor-pointer h-24 w-full object-cover hover:ring-2 ring-brand" />)}
                      </div>
                    </div>
                  )}
                  <form onSubmit={send} className="p-3 flex gap-2 items-center">
                    <input ref={imgRef} type="file" accept="image/*" hidden onChange={onImgPick} />
                    <button type="button" onClick={() => imgRef.current?.click()} disabled={uploadingImg} title="Send a photo"
                      className="h-11 w-11 grid place-items-center rounded-xl bg-white/10 hover:bg-white/20 shrink-0 disabled:opacity-50">
                      {uploadingImg ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
                    </button>
                    <button type="button" onClick={openGif} className={`h-11 px-2 grid place-items-center rounded-xl text-xs font-bold shrink-0 ${gifOpen ? 'bg-brand text-white' : 'bg-white/10 hover:bg-white/20'}`}>GIF</button>
                    <input value={text} onChange={e => setText(e.target.value)} placeholder={recording ? 'Recording…' : 'Message (encrypted)…'} disabled={recording}
                      className="flex-1 bg-ink border border-edge rounded-xl px-4 py-3 outline-none focus:border-brand disabled:opacity-60" />
                    <button type="button" onClick={recording ? stopRec : startRec} disabled={busy || !(isSelf || thread.can_voice)}
                      title={!(isSelf || thread.can_voice) ? 'This person has turned off voice notes from you' : 'Record a voice message'}
                      className={`h-11 w-11 grid place-items-center rounded-xl shrink-0 ${recording ? 'bg-rose-600 animate-pulse' : 'bg-white/10 hover:bg-white/20'} disabled:opacity-40 disabled:cursor-not-allowed`}>
                      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : recording ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
                    </button>
                    <button className="h-11 w-11 grid place-items-center rounded-xl bg-gradient-to-r from-brand to-violet-600 shrink-0"><Send className="h-5 w-5" /></button>
                  </form>
                </div>
              ) : <div className="p-4 border-t border-edge text-center text-sm text-slate-500">You can't DM this person. DMs open only for your Inner Circle or Followers who allow it.</div>}
            </>
          )}
      </div>
    </div>
  )
}
