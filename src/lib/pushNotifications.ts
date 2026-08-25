// FCM push notifications (native Android only). No-ops on web/iOS.
import { Capacitor } from '@capacitor/core'
import { api } from './api'

let configured = false

export async function configurePush() {
  if (configured) return
  if (Capacitor.getPlatform() !== 'android') return
  configured = true
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    let perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') { configured = false; return }

    await PushNotifications.addListener('registration', (token) => {
      api.registerPush(token.value, 'android').catch(() => {})
    })
    await PushNotifications.addListener('registrationError', () => {})
    await PushNotifications.addListener('pushNotificationReceived', () => {
      // App is in the foreground — the badge poller already refreshes counts.
    })
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data: any = action?.notification?.data || {}
      if (data?.url) { try { window.location.hash = data.url } catch {} }
    })
    await PushNotifications.register()
  } catch { configured = false }
}
