// Custom Capacitor plugin bridge for in-call audio routing on Android.
//
// LiveKit (and any WebRTC stack inside an Android WebView) defaults audio
// playback to STREAM_MUSIC — that's why call audio plays through the media
// volume rocker and routes to the loudspeaker. We want call audio to go
// through the earpiece by default and respond to the in-call volume rocker.
//
// The native side lives in:
//   frontend/android-resources/call-audio/CallAudioPlugin.java
// and is injected into the Android project by the APK workflow. It calls
// AudioManager.setMode(MODE_IN_COMMUNICATION) and setSpeakerphoneOn(false)
// when a call starts, and restores the previous mode when it ends.
//
// On web (preview) the plugin isn't registered — these helpers become
// no-ops so the same code path works in both environments.
//
// Every helper below returns a `{ ok, reason, error? }` shape so the caller
// (Call.jsx) can surface diagnostic UI when the native side isn't wired up
// on the APK build — much easier than reading logcat.

import { Capacitor, registerPlugin } from "@capacitor/core";

const CallAudio = registerPlugin("CallAudio");

const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

/** Compact error stringifier so callers can display something meaningful. */
function stringifyErr(e) {
  if (!e) return "unknown";
  if (typeof e === "string") return e;
  return e.message || e.code || JSON.stringify(e).slice(0, 200);
}

export async function startCallAudio({ speaker = false } = {}) {
  if (!isNativeAndroid()) return { ok: false, reason: "not-native", platform: Capacitor.getPlatform() };
  try {
    const result = await CallAudio.start({ speaker });
    return { ok: true, ...result };
  } catch (e) {
    const err = stringifyErr(e);
    console.warn("CallAudio.start unavailable", err);
    return { ok: false, reason: "plugin-error", error: err };
  }
}

export async function stopCallAudio() {
  if (!isNativeAndroid()) return { ok: false, reason: "not-native" };
  try {
    const result = await CallAudio.stop();
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, reason: "plugin-error", error: stringifyErr(e) };
  }
}

export async function setSpeakerphone(on) {
  if (!isNativeAndroid()) return { ok: false, reason: "not-native" };
  try {
    const result = await CallAudio.setSpeakerphone({ on: !!on });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, reason: "plugin-error", error: stringifyErr(e) };
  }
}

/** True when the app is running inside the Android APK (not the browser). */
export function isCallAudioSupported() { return isNativeAndroid(); }
