import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { toast } from "sonner";
import api from "../lib/api";

/**
 * Mount-once-per-app push-notification setup.
 *
 *   1. On native platforms (Android APK / iOS), ask the OS for permission
 *      to show notifications.
 *   2. On `registration`, get the FCM device token and send it to the
 *      backend so the server can target this device for pushes.
 *   3. On `pushNotificationReceived` (app is open in foreground), show
 *      the message as a toast so the user sees something.
 *   4. On `pushNotificationActionPerformed` (user tapped a backgrounded
 *      notification), deep-link into the relevant screen based on the
 *      payload's `type` field (dm, incoming_call, follow_request, etc.).
 *
 * On the web this hook is a no-op — browser push needs a different flow
 * (VAPID + service worker) and isn't on the roadmap yet.
 */
export default function usePushNotifications(user) {
  const nav = useNavigate();

  useEffect(() => {
    if (!user) return;
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;

    const setup = async () => {
      try {
        // Ask the OS. On Android 13+ this triggers the runtime POST_NOTIFICATIONS
        // permission prompt. On older Android the result is always granted.
        const perm = await PushNotifications.checkPermissions();
        if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
          const req = await PushNotifications.requestPermissions();
          if (req.receive !== "granted") {
            // Silent fail — the user can still use the app, just won't get
            // pushes when backgrounded.
            return;
          }
        } else if (perm.receive !== "granted") {
          return;
        }
        if (cancelled) return;
        await PushNotifications.register();
      } catch (e) {
        // PushNotifications throws on simulators / older webviews. Ignore.
        console.warn("push setup failed", e);
      }
    };

    const onRegistered = async (token) => {
      try {
        await api.post("/notifications/register-device", {
          token: token.value,
          platform: Capacitor.getPlatform(),
        });
      } catch (e) {
        console.warn("device register failed", e);
      }
    };

    const onRegError = (err) => {
      console.warn("push registration error", err);
    };

    const onForeground = (notif) => {
      // App is open — Android won't display the notification overlay itself,
      // so we surface it ourselves. Tapping the toast deep-links the same
      // way the backgrounded-tap handler does.
      const title = notif?.title || "New notification";
      const body = notif?.body || "";
      toast.message(title, {
        description: body,
        action: notif?.data?.type ? {
          label: "Open",
          onClick: () => routeFromPayload(notif.data),
        } : undefined,
      });
    };

    const onTapped = (action) => {
      routeFromPayload(action?.notification?.data || {});
    };

    const routeFromPayload = (data) => {
      switch (data.type) {
        case "dm":
          if (data.from_id) nav(`/messages/${data.from_id}`);
          break;
        case "incoming_call":
          // The IncomingCallRinger poll will pick it up within 3s — just
          // make sure the app is on a screen where the ringer mounts.
          if (window.location.pathname.startsWith("/call/")) return;
          nav("/feed");
          break;
        case "follow_request":
        case "new_follower":
        case "inner_invite":
          nav("/notifications");
          break;
        default:
          nav("/feed");
      }
    };

    setup();
    const subs = [
      PushNotifications.addListener("registration", onRegistered),
      PushNotifications.addListener("registrationError", onRegError),
      PushNotifications.addListener("pushNotificationReceived", onForeground),
      PushNotifications.addListener("pushNotificationActionPerformed", onTapped),
    ];

    return () => {
      cancelled = true;
      Promise.all(subs).then((handles) => handles.forEach((h) => h?.remove?.()));
    };
  }, [user, nav]);
}
