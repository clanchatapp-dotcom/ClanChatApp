package app.clanchat.mobile;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * CallAudio — routes voice/video call audio through the earpiece (or the
 * loudspeaker on request) on every Android version from 5.0 up to 15.
 *
 * WHY THIS PLUGIN EXISTS
 * ----------------------
 * A LiveKit WebRTC track inside a Capacitor WebView is treated by Android
 * as "media" audio (STREAM_MUSIC → loudspeaker). To force the call path we
 * have to:
 *   1. Put the AudioManager into MODE_IN_COMMUNICATION (so volume rocker
 *      controls call volume and WebRTC uses the voice pipeline).
 *   2. Request audio focus with USAGE_VOICE_COMMUNICATION so other apps
 *      duck their audio.
 *   3. Explicitly pin the output device.
 *
 * The device-pinning step is the piece that keeps breaking on modern
 * Android. `setSpeakerphoneOn(false)` was the old API — Google *deprecated*
 * it in Android 12 (API 31) and on many OEM builds it is now a silent
 * no-op. The replacement is `AudioManager.setCommunicationDevice(...)`
 * which takes an `AudioDeviceInfo` describing the exact hardware endpoint
 * (earpiece, speakerphone, wired headset, Bluetooth SCO, …).
 *
 * This plugin tries `setCommunicationDevice` first on API 31+, then falls
 * back to `setSpeakerphoneOn` on older Androids.
 */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {

    private static final String TAG = "ClanChatCallAudio";

    private Integer previousMode = null;
    private Boolean previousSpeakerOn = null;
    private AudioFocusRequest audioFocusRequest = null;
    private PowerManager.WakeLock wakeLock = null;
    private AudioDeviceInfo previousCommDevice = null;

    private AudioManager am() {
        Context ctx = getContext();
        if (ctx == null) return null;
        return (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
    }

    private PowerManager pm() {
        Context ctx = getContext();
        if (ctx == null) return null;
        return (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
    }

    /**
     * Find a communication device by type. API 31+ only. Returns null if
     * the device isn't currently available (e.g. no earpiece on a tablet).
     */
    private AudioDeviceInfo findCommDevice(AudioManager audio, int type) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null;
        try {
            List<AudioDeviceInfo> devices = audio.getAvailableCommunicationDevices();
            for (AudioDeviceInfo d : devices) {
                if (d.getType() == type) return d;
            }
        } catch (Exception e) {
            Log.w(TAG, "findCommDevice failed: " + e.getMessage());
        }
        return null;
    }

    /**
     * Route call audio to the requested output. Modern Android (API 31+):
     * setCommunicationDevice. Older: setSpeakerphoneOn.
     *
     * Returns a short description of what actually happened, used by the
     * frontend diagnostic banner.
     */
    private String routeAudio(AudioManager audio, boolean speaker) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            int wantedType = speaker
                    ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                    : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            AudioDeviceInfo target = findCommDevice(audio, wantedType);
            if (target != null) {
                try {
                    boolean ok = audio.setCommunicationDevice(target);
                    Log.i(TAG, "setCommunicationDevice(type=" + wantedType + ") -> " + ok);
                    if (ok) return "setCommunicationDevice:" + wantedType;
                } catch (Exception e) {
                    Log.w(TAG, "setCommunicationDevice threw: " + e.getMessage());
                }
            } else {
                Log.w(TAG, "Requested device type " + wantedType + " not in available comm devices");
            }
            // Fall through to legacy path if setCommunicationDevice failed.
        }
        try {
            audio.setSpeakerphoneOn(speaker);
            Log.i(TAG, "setSpeakerphoneOn(" + speaker + ") legacy path");
            return "setSpeakerphoneOn:" + speaker;
        } catch (Exception e) {
            Log.w(TAG, "setSpeakerphoneOn threw: " + e.getMessage());
            return "route_failed";
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        AudioManager audio = am();
        if (audio == null) {
            call.reject("AudioManager unavailable");
            return;
        }
        boolean speaker = call.getBoolean("speaker", false);
        try {
            // Snapshot prior state so stop() can restore it exactly.
            if (previousMode == null) {
                previousMode = audio.getMode();
                previousSpeakerOn = audio.isSpeakerphoneOn();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    try { previousCommDevice = audio.getCommunicationDevice(); }
                    catch (Exception ignore) { previousCommDevice = null; }
                }
            }

            // Request audio focus as a voice call FIRST. Doing this before
            // switching mode gives the OS a chance to grant the focus before
            // WebRTC starts pumping audio, so the pipeline is set up on the
            // voice call stream from the very first sample.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(attrs)
                        .setAcceptsDelayedFocusGain(false)
                        .build();
                audio.requestAudioFocus(audioFocusRequest);
            } else {
                //noinspection deprecation
                audio.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL,
                        AudioManager.AUDIOFOCUS_GAIN);
            }

            // In-communication mode → voice pipeline, volume rocker maps to
            // STREAM_VOICE_CALL, WebRTC hooks into the telephony audio path.
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);

            // Now pin the output device (earpiece by default).
            String routed = routeAudio(audio, speaker);

            // Hold a partial wake lock so CPU stays live when the screen
            // turns off. Without it, WebView audio can be throttled to a
            // trickle. `ACQUIRE_CAUSES_WAKEUP` deliberately NOT set — we
            // don't want to force the screen back on.
            PowerManager power = pm();
            if (power != null && wakeLock == null) {
                wakeLock = power.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "ClanChat::CallAudio"
                );
                wakeLock.setReferenceCounted(false);
                // Time out at 2h — a safety net if stop() is somehow never
                // called (crash, force-kill). Real calls will call stop()
                // long before this.
                wakeLock.acquire(2 * 60 * 60 * 1000L);
            }

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("mode", "in_communication");
            ret.put("speaker", speaker);
            ret.put("route", routed);
            ret.put("api", Build.VERSION.SDK_INT);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "start failed", e);
            call.reject("Failed to set call audio mode: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        AudioManager audio = am();
        if (audio == null) {
            call.reject("AudioManager unavailable");
            return;
        }
        try {
            // Restore output device first, then mode, so any last audio
            // sample plays through the pre-call device.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    if (previousCommDevice != null) {
                        audio.setCommunicationDevice(previousCommDevice);
                    } else {
                        audio.clearCommunicationDevice();
                    }
                } catch (Exception e) {
                    Log.w(TAG, "restore comm device failed: " + e.getMessage());
                }
            }
            int restoreMode = previousMode != null ? previousMode : AudioManager.MODE_NORMAL;
            boolean restoreSpeaker = previousSpeakerOn != null && previousSpeakerOn;
            audio.setMode(restoreMode);
            try { audio.setSpeakerphoneOn(restoreSpeaker); } catch (Exception ignore) { /* legacy */ }
            previousMode = null;
            previousSpeakerOn = null;
            previousCommDevice = null;

            // Release audio focus.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (audioFocusRequest != null) {
                    audio.abandonAudioFocusRequest(audioFocusRequest);
                    audioFocusRequest = null;
                }
            } else {
                //noinspection deprecation
                audio.abandonAudioFocus(null);
            }

            // Release wake lock.
            if (wakeLock != null && wakeLock.isHeld()) {
                try { wakeLock.release(); } catch (Throwable ignore) {}
            }
            wakeLock = null;

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "stop failed", e);
            call.reject("Failed to restore audio mode: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void setSpeakerphone(PluginCall call) {
        AudioManager audio = am();
        if (audio == null) {
            call.reject("AudioManager unavailable");
            return;
        }
        boolean on = call.getBoolean("on", false);
        try {
            // Re-assert MODE_IN_COMMUNICATION in case something (e.g. a
            // background media event) knocked it out mid-call.
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            String routed = routeAudio(audio, on);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("speaker", on);
            ret.put("route", routed);
            ret.put("api", Build.VERSION.SDK_INT);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "setSpeakerphone failed", e);
            call.reject("Failed to set speakerphone: " + e.getMessage(), e);
        }
    }
}
