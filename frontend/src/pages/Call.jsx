import { useEffect, useState, useCallback } from "react";
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
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, SwitchCamera } from "lucide-react";
import "@livekit/components-styles";
import api from "../lib/api";

/**
 * /call/:callId  — full-screen call UI.
 *
 * Layout is explicitly z-stacked instead of relying on flex distribution
 * inside <LiveKitRoom>, because LiveKit's internal CSS sometimes consumed
 * the entire viewport on small mobile screens, hiding the controls bar.
 * Now:
 *   - <CallStage>   absolutely fills the screen (the video grid / audio art)
 *   - <CallControls> sits on top with `fixed` + safe-area bottom inset,
 *     so hang-up / mute / camera-switch are always reachable.
 */
export default function Call() {
  const { callId } = useParams();
  const nav = useNavigate();
  const session = window.history.state?.usr?.session;
  const [hungUp, setHungUp] = useState(false);

  useEffect(() => {
    if (!session?.token) nav("/messages", { replace: true });
  }, [session, nav]);

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
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  if (kind === "audio") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pb-40">
        <div className="w-28 h-28 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6">
          <Mic size={36} className="text-zinc-500" />
        </div>
        <div className="text-zinc-400 text-sm uppercase tracking-[0.2em]">Voice call</div>
        <div className="text-zinc-600 text-xs mt-2">{tracks.length} participant{tracks.length === 1 ? "" : "s"}</div>
      </div>
    );
  }

  // Video: explicitly position the grid to fill the *visible* viewport
  // minus the bottom control bar height so participant tiles never get
  // cropped/off-centre on small phones.
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        // Pad bottom by the control bar height (≈112px including safe area)
        // so participant tiles aren't centred behind the controls.
        paddingBottom: "calc(7rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <GridLayout tracks={tracks} className="h-full w-full">
        <ParticipantTile />
      </GridLayout>
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
      // Find the current camera track and swap deviceId between user-facing
      // and environment-facing cameras. The LiveKit client exposes the
      // underlying MediaStreamTrack so we can read facingMode and ask for
      // the opposite one.
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
      className="absolute left-0 right-0 bottom-0 z-10 bg-black/85 backdrop-blur border-t border-zinc-900 px-6 pt-4"
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
