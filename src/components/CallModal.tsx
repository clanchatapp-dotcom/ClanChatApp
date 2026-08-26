import { useEffect, useState } from 'react'
import { LiveKitRoom, VideoConference } from '@livekit/components-react'
import { api } from '../lib/api'
import { X, Loader2 } from 'lucide-react'

export default function CallModal({ room, peer, onClose }: { room: string; peer?: string; onClose: () => void }) {
  const [creds, setCreds] = useState<{ server_url: string; participant_token: string } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let c = false
    api.livekitToken(room, peer).then(r => { if (!c) setCreds(r) }).catch(e => { if (!c) setErr(e.message) })
    return () => { c = true }
  }, [room, peer])

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-between px-4 h-14 border-b border-edge shrink-0">
        <span className="font-semibold truncate">Call{peer ? ` · @${peer}` : ''}</span>
        <button onClick={onClose} className="h-9 w-9 grid place-items-center rounded-lg hover:bg-white/10 shrink-0"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {err ? <div className="h-full grid place-items-center text-rose-400">{err}</div>
          : !creds ? <div className="h-full grid place-items-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          : (
            <div data-lk-theme="default" className="h-full">
              <LiveKitRoom token={creds.participant_token} serverUrl={creds.server_url}
                connect audio video style={{ height: '100%' }} onDisconnected={onClose}>
                <VideoConference />
              </LiveKitRoom>
            </div>
          )}
      </div>
    </div>
  )
}
