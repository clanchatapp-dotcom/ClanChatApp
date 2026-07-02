import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ParticipantTile,
  useTracks,
  useLocalParticipant,
  useRoomContext,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff,
  SwitchCamera, Volume2, Volume1, MonitorUp, MonitorOff,
} from "lucide-react";
import "@livekit/components-styles";
import api from "../lib/api";
import { startCallAudio, stopCallAudio, setSpeakerphone } from "../lib/callAudio";

/**
 * /call/:callId  — full-screen call UI.
 *
 * Layout:
 *   - Mobile (<1024px): remote fills the screen; local camera is a small
 *     PiP tile in the top-right.
 *   - Desktop (≥1024px): 2-column grid — remote on the left, local on the
 *     right, both large. Screen-share, if active, replaces the main tile.
 *
 * Keyboard shortcuts (desktop only): `M` = mute, `V` = camera,
 * `S` = speaker, `End` or `Escape` = hang up.
 *
 * Android audio is routed through MODE_IN_COMMUNICATION via the CallAudio
 * native plugin so the volume rocker controls call volume and audio plays
 * through the earpiece by default.
 */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return isDesktop;
}

export default function Call() {
  const { callId } = useParams();
  const nav = useNavigate();
  const session = window.history.state?.usr?.session;
  const [hungUp, setHungUp] = useState(false);

  useEffect(() => {
    if (!session?.token) nav("/messages", { replace: true });
  }, [session, nav]);

  useEffect(() => {
    if (!session?.token) return;
    startCallAudio({ speaker: false }).catch((e) => console.warn("call audio start failed", e));
    // WebRTC in Capacitor's WebView will sometimes re-init its own audio
    // session ~1s after connect and put us back on the media stream.
    // Re-apply after a short delay to catch that race, then again a few
    // seconds later for good measure.
    const t1 = setTimeout(() => { startCallAudio({ speaker: false }).catch(() => {}); }, 1500);
    const t2 = setTimeout(() => { startCallAudio({ speaker: false }).catch(() => {}); }, 4000);
    return () => {
      clearTimeout(t1); clearTimeout(t2);
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
        <CallTimer />
        <CallControls onHangup={onDisconnect} kind={session.kind} />
      </LiveKitRoom>
    </div>
  );
}

function CallStage({ kind }) {
  const isDesktop = useIsDesktop();

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const localCam = tracks.find(
    (t) => t.participant?.isLocal && t.source === Track.Source.Camera
  );
  const remoteCam = tracks.find(
    (t) => !t.participant?.isLocal && t.source === Track.Source.Camera
  );
  const anyScreenShare = tracks.find((t) => t.source === Track.Source.ScreenShare);

  // Screen share always takes centre stage when active.
  const mainTrack = anyScreenShare || remoteCam || localCam;
  const pipTrack = anyScreenShare
    ? (remoteCam || localCam)
    : (remoteCam ? localCam : null);

  if (kind === "audio") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pb-40">
        <div className="w-28 h-28 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6">
          <Mic size={36} className="text-zinc-500" />
        </div>
        <div className="text-zinc-400 text-sm uppercase tracking-[0.2em]">Voice call</div>
        <div className="text-zinc-600 text-xs mt-2">
          {remoteCam ? "Connected" : "Waiting for the other person…"}
        </div>
      </div>
    );
  }

  // ---- Desktop 2-column layout ----
  if (isDesktop && remoteCam && localCam) {
    return (
      <div
        className="absolute inset-0 grid grid-cols-2 gap-3 p-4 overflow-hidden"
        style={{ paddingBottom: "8rem" }}
        data-testid="call-desktop-grid"
      >
        <div className="rounded-2xl overflow-hidden bg-zinc-900 relative">
          <ParticipantTile trackRef={mainTrack} className="!h-full !w-full" />
          <div className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wider bg-black/70 text-zinc-300 px-2 py-0.5 rounded">
            {anyScreenShare ? "Screen share" : "Them"}
          </div>
        </div>
        <div className="rounded-2xl overflow-hidden bg-zinc-900 relative">
          <ParticipantTile trackRef={pipTrack} className="!h-full !w-full" />
          <div className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wider bg-black/70 text-zinc-300 px-2 py-0.5 rounded">
            You
          </div>
        </div>
      </div>
    );
  }

  // ---- Mobile / single-participant layout ----
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ paddingBottom: "calc(7rem + env(safe-area-inset-bottom, 0px))" }}
    >
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

function CallTimer() {
  // Elapsed-time display anchored to the moment LiveKit tells us the room
  // is connected. Falls back to component mount time if the room isn't
  // available yet. Ticks every second in a tight interval.
  const room = useRoomContext();
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState(null);

  useEffect(() => {
    // Try to read the real "room connected at" moment from LiveKit; if it's
    // not exposed, fall back to the mount time.
    const started = room?.state === "connected" ? Date.now() : null;
    setStartedAt(started || Date.now());
  }, [room?.state]);

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 z-30 bg-black/60 backdrop-blur border border-zinc-800 rounded-full px-3 py-1 text-xs font-mono text-zinc-200 pointer-events-none"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
      data-testid="call-timer"
    >
      {mm}:{ss}
    </div>
  );
}

function CallControls({ onHangup, kind }) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const isDesktop = useIsDesktop();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(kind === "video");
  const [switching, setSwitching] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);

  const toggleMic = useCallback(async () => {
    const next = !micOn;
    try { await localParticipant.setMicrophoneEnabled(next); setMicOn(next); }
    catch (e) { console.warn("mic toggle failed", e); }
  }, [micOn, localParticipant]);

  const toggleCam = useCallback(async () => {
    if (kind !== "video") return;
    const next = !camOn;
    try { await localParticipant.setCameraEnabled(next); setCamOn(next); }
    catch (e) { console.warn("cam toggle failed", e); }
  }, [camOn, localParticipant, kind]);

  const switchCam = useCallback(async () => {
    if (switching) return;
    setSwitching(true);
    try {
      const cameraPub = localParticipant.getTrackPublication?.(Track.Source.Camera);
      const mediaTrack = cameraPub?.track?.mediaStreamTrack;
      const currentFacing = mediaTrack?.getSettings?.().facingMode || "user";
      const nextFacing = currentFacing === "user" ? "environment" : "user";
      await localParticipant.setCameraEnabled(true, { facingMode: nextFacing });
    } catch (e) { console.warn("camera switch failed", e); }
    finally { setSwitching(false); }
  }, [localParticipant, switching]);

  const toggleSpeaker = useCallback(async () => {
    const next = !speakerOn;
    try { await setSpeakerphone(next); setSpeakerOn(next); }
    catch (e) { console.warn("speaker toggle failed", e); }
  }, [speakerOn]);

  const toggleScreenShare = useCallback(async () => {
    try {
      const next = !screenSharing;
      await localParticipant.setScreenShareEnabled(next);
      setScreenSharing(next);
    } catch (e) {
      console.warn("screen share toggle failed", e);
      // Browser may reject if the user cancels the picker — flip state back.
      setScreenSharing(false);
    }
  }, [screenSharing, localParticipant]);

  // Keyboard shortcuts (desktop). Anchored to `room` so we don't hijack
  // typing in unrelated apps if the tab is backgrounded.
  useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e) => {
      // Ignore keys typed into inputs / textareas.
      const t = e.target;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      if (e.key === "m" || e.key === "M") { e.preventDefault(); toggleMic(); }
      else if (e.key === "v" || e.key === "V") { e.preventDefault(); toggleCam(); }
      else if (e.key === "s" || e.key === "S") { e.preventDefault(); toggleSpeaker(); }
      else if (e.key === "Escape" || e.key === "End") { e.preventDefault(); onHangup(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDesktop, toggleMic, toggleCam, toggleSpeaker, onHangup]);

  const canScreenShare = useMemo(
    () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia,
    []
  );

  return (
    <div
      className="absolute left-0 right-0 bottom-0 z-30 bg-black/85 backdrop-blur border-t border-zinc-900 px-6 pt-4"
      style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
      data-testid="call-controls"
    >
      <div className="flex items-center justify-center gap-3 sm:gap-5 flex-wrap">
        <ControlButton
          testId="call-toggle-mic"
          onClick={toggleMic}
          label={micOn ? "Mute" : "Unmute"}
          active={!micOn}
        >{micOn ? <Mic size={18} /> : <MicOff size={18} />}</ControlButton>

        {kind === "video" && (
          <>
            <ControlButton
              testId="call-toggle-cam"
              onClick={toggleCam}
              label={camOn ? "Camera off" : "Camera on"}
              active={!camOn}
            >{camOn ? <VideoIcon size={18} /> : <VideoOff size={18} />}</ControlButton>

            <ControlButton
              testId="call-switch-cam"
              onClick={switchCam}
              disabled={switching || !camOn}
              label="Switch camera"
            >
              <SwitchCamera size={18} />
            </ControlButton>

            {canScreenShare && (
              <ControlButton
                testId="call-screen-share"
                onClick={toggleScreenShare}
                active={screenSharing}
                label={screenSharing ? "Stop sharing" : "Share screen"}
              >
                {screenSharing ? <MonitorOff size={18} /> : <MonitorUp size={18} />}
              </ControlButton>
            )}
          </>
        )}

        <ControlButton
          testId="call-speaker"
          onClick={toggleSpeaker}
          active={speakerOn}
          label={speakerOn ? "Earpiece" : "Speakerphone"}
        >
          {speakerOn ? <Volume2 size={18} /> : <Volume1 size={18} />}
        </ControlButton>

        <button
          data-testid="call-hangup"
          onClick={onHangup}
          className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg"
          aria-label="Hang up"
        >
          <PhoneOff size={20} />
        </button>
      </div>
      {isDesktop && (
        <div className="text-center text-[10px] text-zinc-600 mt-3 tracking-wider">
          Shortcuts · M mute · V camera · S speaker · Esc hang up
        </div>
      )}
    </div>
  );
}

function ControlButton({ testId, onClick, active, disabled, children, label }) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`w-12 h-12 rounded-full flex items-center justify-center border transition disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "border-[#FF5A00] text-[#FF5A00] bg-[#FF5A00]/10"
          : "border-zinc-700 bg-zinc-900 text-white hover:border-zinc-500"
      }`}
    >
      {children}
    </button>
  );
}
