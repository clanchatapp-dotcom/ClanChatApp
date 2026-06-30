import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ParticipantTile,
  useTracks,
  useLocalParticipant,
  GridLayout,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff } from "lucide-react";
import "@livekit/components-styles";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";

/**
 * /call/:callId  — full-screen call UI.
 *
 * Two entry paths land here:
 *   1. Caller has just hit POST /calls/start and was redirected here with
 *      the token in router state. They wait in the room until callee joins.
 *   2. Callee has just accepted an incoming-call dialog and was redirected
 *      here with the token from POST /calls/{id}/answer.
 *
 * Both paths receive: { token, livekit_url, room_name, kind }
 *
 * The Capacitor APK needs the user to grant native CAMERA + RECORD_AUDIO
 * permissions which are declared in AndroidManifest.xml (added in the
 * github workflow). LiveKit's client SDK triggers the OS prompt the first
 * time we publish a track.
 */
export default function Call() {
  const { callId } = useParams();
  const nav = useNavigate();
  const session = window.history.state?.usr?.session;
  const [hungUp, setHungUp] = useState(false);

  // If the user refreshed mid-call the token state is lost. Send them home.
  useEffect(() => {
    if (!session?.token) {
      nav("/messages", { replace: true });
    }
  }, [session, nav]);

  const onDisconnect = useCallback(async () => {
    if (hungUp) return;
    setHungUp(true);
    try { await api.post(`/calls/${callId}/end`); } catch { /* server may already know */ }
    nav("/messages", { replace: true });
  }, [callId, hungUp, nav]);

  if (!session?.token) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" data-testid="call-screen">
      <LiveKitRoom
        token={session.token}
        serverUrl={session.livekit_url}
        connect
        audio
        video={session.kind === "video"}
        onDisconnected={onDisconnect}
        className="flex-1 flex flex-col"
        data-lk-theme="default"
      >
        <RoomAudioRenderer />
        <CallStage kind={session.kind} />
        <CallControls onHangup={onDisconnect} kind={session.kind} />
      </LiveKitRoom>
    </div>
  );
}

function CallStage({ kind }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  if (kind === "audio") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <div className="w-28 h-28 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6">
          <Mic size={36} className="text-zinc-500" />
        </div>
        <div className="text-zinc-400 text-sm uppercase tracking-[0.2em]">Voice call</div>
        <div className="text-zinc-600 text-xs mt-2">{tracks.length} participant{tracks.length === 1 ? "" : "s"}</div>
      </div>
    );
  }
  return (
    <div className="flex-1 relative">
      <GridLayout tracks={tracks} className="h-full">
        <ParticipantTile />
      </GridLayout>
    </div>
  );
}

function CallControls({ onHangup, kind }) {
  const { localParticipant } = useLocalParticipant();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(kind === "video");
  const hungUpRef = useRef(false);

  const toggleMic = async () => {
    const next = !micOn;
    await localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  };
  const toggleCam = async () => {
    const next = !camOn;
    await localParticipant.setCameraEnabled(next);
    setCamOn(next);
  };
  const hangup = () => {
    if (hungUpRef.current) return;
    hungUpRef.current = true;
    onHangup();
  };

  return (
    <div className="bg-black/70 backdrop-blur border-t border-zinc-900 px-6 py-5 flex items-center justify-center gap-5" data-testid="call-controls">
      <button
        data-testid="call-toggle-mic"
        onClick={toggleMic}
        className={`w-12 h-12 rounded-full flex items-center justify-center border ${micOn ? "border-zinc-700 bg-zinc-900 text-white" : "border-red-500/40 bg-red-500/10 text-red-300"}`}
        aria-label={micOn ? "Mute" : "Unmute"}
      >
        {micOn ? <Mic size={18} /> : <MicOff size={18} />}
      </button>
      {kind === "video" && (
        <button
          data-testid="call-toggle-cam"
          onClick={toggleCam}
          className={`w-12 h-12 rounded-full flex items-center justify-center border ${camOn ? "border-zinc-700 bg-zinc-900 text-white" : "border-red-500/40 bg-red-500/10 text-red-300"}`}
          aria-label={camOn ? "Camera off" : "Camera on"}
        >
          {camOn ? <VideoIcon size={18} /> : <VideoOff size={18} />}
        </button>
      )}
      <button
        data-testid="call-hangup"
        onClick={hangup}
        className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center"
        aria-label="Hang up"
      >
        <PhoneOff size={20} />
      </button>
    </div>
  );
}
