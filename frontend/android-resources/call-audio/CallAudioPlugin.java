package app.clanchat.mobile;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * CallAudio — switches the Android audio system into in-communication
 * mode for the duration of a voice/video call.
 *
 * Without this, WebRTC audio inside the WebView plays through STREAM_MUSIC,
 * so the volume rocker controls media volume and audio routes to the
 * loudspeaker. After start() the system treats the call like a regular
 * phone call: earpiece by default, volume rocker controls call volume,
 * Bluetooth headsets switch automatically.
 *
 * Methods:
 *   start({ speaker?: boolean })   — enter MODE_IN_COMMUNICATION
 *   stop()                          — restore the previous mode
 *   setSpeakerphone({ on: boolean })— toggle speakerphone mid-call
 *
 * Registered in MainActivity via the APK workflow.
 */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {

    private Integer previousMode = null;
    private Boolean previousSpeakerOn = null;

    private AudioManager am() {
        Context ctx = getContext();
        if (ctx == null) return null;
        return (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
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
            // Stash the prior state so stop() can put the device back
            // exactly the way the user left it.
            if (previousMode == null) {
                previousMode = audio.getMode();
                previousSpeakerOn = audio.isSpeakerphoneOn();
            }
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audio.setSpeakerphoneOn(speaker);
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
            // Restore prior mode if we captured it. Otherwise default to
            // MODE_NORMAL so we never leave the device stuck in call mode.
            int restoreMode = previousMode != null ? previousMode : AudioManager.MODE_NORMAL;
            boolean restoreSpeaker = previousSpeakerOn != null ? previousSpeakerOn : false;
            audio.setMode(restoreMode);
            audio.setSpeakerphoneOn(restoreSpeaker);
            previousMode = null;
            previousSpeakerOn = null;
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
