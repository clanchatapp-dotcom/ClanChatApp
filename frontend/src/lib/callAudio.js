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

import { Capacitor, registerPlugin } from "@capacitor/core";

// `registerPlugin` returns a proxy. If the native side isn't there, calls
// reject with an UNIMPLEMENTED error — we swallow that below so the web
// build never throws.
const CallAudio = registerPlugin("CallAudio");

const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

export async function startCallAudio({ speaker = false } = {}) {
  if (!isNativeAndroid()) return { ok: false, reason: "not-native" };
  try {
    return await CallAudio.start({ speaker });
  } catch (e) {
    console.warn("CallAudio.start unavailable", e?.message || e);
    return { ok: false, reason: "unimplemented" };
  }
}

export async function stopCallAudio() {
  if (!isNativeAndroid()) return { ok: false, reason: "not-native" };
  try {
    return await CallAudio.stop();
  } catch (e) {
    console.warn("CallAudio.stop unavailable", e?.message || e);
    return { ok: false, reason: "unimplemented" };
  }
}

export async function setSpeakerphone(on) {
  if (!isNativeAndroid()) return { ok: false, reason: "not-native" };
  try {
    return await CallAudio.setSpeakerphone({ on: !!on });
  } catch (e) {
    console.warn("CallAudio.setSpeakerphone unavailable", e?.message || e);
    return { ok: false, reason: "unimplemented" };
  }
}
