package app.clanchat.mobile;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.PowerManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * CallAudio — hard-wires the Android audio system into in-call mode for
 * the duration of a voice/video call, and holds a partial wake lock so
 * the audio pipeline keeps running when the screen locks.
 *
 * Without this plugin:
 *   - WebRTC audio inside a WebView plays through STREAM_MUSIC. Volume
 *     rocker controls media volume, audio routes to the loudspeaker,
 *     Bluetooth headsets ignore it.
 *   - When the user locks the screen mid-call, Android may throttle the
 *     WebView's audio processing → the other party hears silence.
 *
 * With this plugin:
 *   - MODE_IN_COMMUNICATION → OS treats it as a phone call. Volume rocker
 *     controls call volume, earpiece by default, Bluetooth switches
 *     automatically.
 *   - Audio focus request with USAGE_VOICE_COMMUNICATION → other apps
 *     duck their audio.
 *   - PARTIAL_WAKE_LOCK → CPU stays on for background audio, screen can
 *     still turn off (which is desired for voice calls; user's ear is on
 *     the phone).
 *
 * Registered in MainActivity via the APK workflow.
 */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {

    private Integer previousMode = null;
    private Boolean previousSpeakerOn = null;
    private AudioFocusRequest audioFocusRequest = null;
    private PowerManager.WakeLock wakeLock = null;

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
            }

            // Request audio focus as a voice call. On Android O+ we go via
            // the AudioFocusRequest builder; older Androids fall back to
            // the deprecated one-shot API.
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

            // In-communication mode + earpiece (or speakerphone if the
            // caller opted in — video calls sometimes want loudspeaker).
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audio.setSpeakerphoneOn(speaker);

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
            call.resolve(ret);
        } catch (Exception e) {
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
            int restoreMode = previousMode != null ? previousMode : AudioManager.MODE_NORMAL;
            boolean restoreSpeaker = previousSpeakerOn != null && previousSpeakerOn;
            audio.setMode(restoreMode);
            audio.setSpeakerphoneOn(restoreSpeaker);
            previousMode = null;
            previousSpeakerOn = null;

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
            audio.setSpeakerphoneOn(on);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("speaker", on);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to set speakerphone: " + e.getMessage(), e);
        }
    }
}
