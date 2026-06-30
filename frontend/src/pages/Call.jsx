import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ParticipantTile,
  useTracks,
  useLocalParticipant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, SwitchCamera } from "lucide-react";
import "@livekit/components-styles";
import api from "../lib/api";
import { startCallAudio, stopCallAudio } from "../lib/callAudio";

/**
 * /call/:callId  — full-screen call UI.
 *
 * Layout:
 *   - Remote participant fills the screen (main view).
 *   - Local participant is a small picture-in-picture tile pinned
 *     to the top-right.
 *   - Controls sit at the bottom with safe-area inset.
 *
 * On Android (Capacitor) we route audio through the in-call earpiece via
 * the CallAudio native plugin so the volume rocker controls call volume
 * and the audio doesn't play as media.
 */
export default function Call() {
  const { callId } = useParams();
  const nav = useNavigate();
  const session = window.history.state?.usr?.session;
  const [hungUp, setHungUp] = useState(false);

  useEffect(() => {
    if (!session?.token) nav("/messages", { replace: true });
  }, [session, nav]);

  // Switch Android into in-communication audio mode for the lifetime of
  // the call. No-op on web. Always restored on unmount even if the call
  // ends abnormally.
  useEffect(() => {
    if (!session?.token) return;
    startCallAudio({ speaker: false }).catch((e) => console.warn("call audio start failed", e));
    return () => {
      stopCallAudio().catch((e) => console.warn("call audio stop failed", e));
    };
  }, [session]);

  const onDisconnect = useCallback(async () => {
    if (hungUp) return;
    setHungUp(true);
    try { await api.post(`/calls/${callId}/end`); } catch { /* server may already know */ }
    nav("/messages", { replace: true });
  }, [callId, hungUp, nav]);

  if (!session?.token) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black" data-testid="call-screen">
      <LiveKitRoom
        token={session.token}
        serverUrl={session.livekit_url}
        connect
        audio
        video={session.kind === "video"}
        onDisconnected={onDisconnect}
        className="absolute inset-0 flex flex-col"
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
  // Pull every camera track in the room. We split into local vs remote so
  // the remote participant gets the fullscreen and the local goes into a
  // small PiP tile.
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const localTracks = tracks.filter((t) => t.participant?.isLocal);
  const remoteTracks = tracks.filter((t) => !t.participant?.isLocal);
  // Pick the first remote camera track if any, otherwise fall back to the
  // local one so the user sees themselves while waiting.
  const mainTrack = remoteTracks[0] || localTracks[0];
  const pipTrack = remoteTracks.length > 0 ? localTracks[0] : null;

  if (kind === "audio") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pb-40">
        <div className="w-28 h-28 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6">
          <Mic size={36} className="text-zinc-500" />
        </div>
        <div className="text-zinc-400 text-sm uppercase tracking-[0.2em]">Voice call</div>
        <div className="text-zinc-600 text-xs mt-2">
          {remoteTracks.length > 0 ? "Connected" : "Waiting for the other person…"}
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        paddingBottom: "calc(7rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      {/* Main view — remote participant fullscreen. Falls back to a soft
          placeholder while we're still waiting for them to join. */}
      <div className="absolute inset-0">
        {mainTrack ? (
          <ParticipantTile trackRef={mainTrack} className="!h-full !w-full" />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center text-zinc-500">
            <VideoIcon size={36} className="mb-3 opacity-60" />
            <div className="text-sm">Waiting for the other person…</div>
          </div>
        )}
      </div>

      {/* Picture-in-picture — local camera in the top-right.
          Only shown when there's an actual remote participant, otherwise
          the local feed is already the main view. */}
      {pipTrack && (
        <div
          className="absolute right-3 z-20 rounded-xl overflow-hidden border border-zinc-700 shadow-xl"
          style={{
            top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
            width: "28%",
            maxWidth: 160,
            aspectRatio: "3 / 4",
          }}
          data-testid="call-pip"
        >
          <ParticipantTile trackRef={pipTrack} className="!h-full !w-full" />
        </div>
      )}
    </div>
  );
}

function CallControls({ onHangup, kind }) {
  const { localParticipant } = useLocalParticipant();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(kind === "video");
  const [switching, setSwitching] = useState(false);

  const toggleMic = async () => {
    const next = !micOn;
    try { await localParticipant.setMicrophoneEnabled(next); setMicOn(next); }
    catch (e) { console.warn("mic toggle failed", e); }
  };
  const toggleCam = async () => {
    const next = !camOn;
    try { await localParticipant.setCameraEnabled(next); setCamOn(next); }
    catch (e) { console.warn("cam toggle failed", e); }
  };
  const switchCam = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      const cameraPub = localParticipant.getTrackPublication?.(Track.Source.Camera);
      const mediaTrack = cameraPub?.track?.mediaStreamTrack;
      const currentFacing = mediaTrack?.getSettings?.().facingMode || "user";
      const nextFacing = currentFacing === "user" ? "environment" : "user";
      await localParticipant.setCameraEnabled(true, { facingMode: nextFacing });
    } catch (e) {
      console.warn("camera switch failed", e);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div
      className="absolute left-0 right-0 bottom-0 z-30 bg-black/85 backdrop-blur border-t border-zinc-900 px-6 pt-4"
      style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
      data-testid="call-controls"
    >
      <div className="flex items-center justify-center gap-5">
        <button
          data-testid="call-toggle-mic"
          onClick={toggleMic}
          className={`w-12 h-12 rounded-full flex items-center justify-center border ${micOn ? "border-zinc-700 bg-zinc-900 text-white" : "border-red-500/40 bg-red-500/10 text-red-300"}`}
          aria-label={micOn ? "Mute" : "Unmute"}
        >
          {micOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        {kind === "video" && (
          <>
            <button
              data-testid="call-toggle-cam"
              onClick={toggleCam}
              className={`w-12 h-12 rounded-full flex items-center justify-center border ${camOn ? "border-zinc-700 bg-zinc-900 text-white" : "border-red-500/40 bg-red-500/10 text-red-300"}`}
              aria-label={camOn ? "Camera off" : "Camera on"}
            >
              {camOn ? <VideoIcon size={18} /> : <VideoOff size={18} />}
            </button>
            <button
              data-testid="call-switch-cam"
              onClick={switchCam}
              disabled={switching || !camOn}
              className="w-12 h-12 rounded-full flex items-center justify-center border border-zinc-700 bg-zinc-900 text-white disabled:opacity-40"
              aria-label="Switch camera"
              title="Switch camera"
            >
              <SwitchCamera size={18} />
            </button>
          </>
        )}
        <button
          data-testid="call-hangup"
          onClick={onHangup}
          className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg"
          aria-label="Hang up"
        >
          <PhoneOff size={20} />
        </button>
      </div>
    </div>
  );
}
