# ClanChat — Native App (Capacitor) Build Guide

This document explains how to wrap the existing React web app into native
**iOS** and **Android** binaries using [Capacitor](https://capacitorjs.com)
so we can ship to the App Store / Play Store without rewriting in React Native.

## What's already in place

- `frontend/capacitor.config.js` — app id `app.clanchat.mobile`, status bar
  + splash screen tuned for the true-black aesthetic, mixed content blocked.
- The web app is already mobile-first, so no UI changes are required.
- All API calls go through `REACT_APP_BACKEND_URL` — Capacitor passes that
  through to the webview, so prod/staging URLs work the same.

## One-time setup (on a Mac for iOS)

```bash
cd /app/frontend

# 1. Install Capacitor core + CLI + iOS/Android platforms
yarn add @capacitor/core @capacitor/cli
yarn add @capacitor/ios @capacitor/android
yarn add @capacitor/splash-screen @capacitor/status-bar @capacitor/preferences

# 2. Build the React app
yarn build

# 3. Initialise native platforms (creates ios/ and android/ folders)
npx cap add ios
npx cap add android

# 4. Sync web build into native projects
npx cap sync
```

## Auth migration required for native

The current web app authenticates via **httpOnly cookies** (set by the
backend on `/api/auth/login`). Webviews on iOS/Android either drop or
sandbox these cookies, causing logout-on-relaunch issues.

**Required change before shipping native:**

1. Add a `/api/auth/login-bearer` endpoint that returns the JWT in the
   response body instead of setting cookies. (Easy — pull JWT issuance out of
   the existing `set_auth_cookies` helper.)
2. On native, store the token via `@capacitor/preferences` (secure encrypted
   storage on iOS Keychain / Android EncryptedSharedPreferences).
3. Update `lib/api.js` axios interceptor to attach `Authorization: Bearer
   <token>` when running in Capacitor (`Capacitor.isNativePlatform()`).

The backend already supports bearer auth via the same `get_current_user`
dependency — we just need a body-returning login endpoint.

## Push notifications (FCM + APNs)

```bash
yarn add @capacitor/push-notifications
```

Backend needs to:
1. Store device tokens per user (`device_tokens` collection: `{user_id, token, platform, last_seen}`).
2. Add a worker that sends push on: new follow/IC accept, new DM, new
   group chat message, tag approved, strike issued.
3. Use FCM HTTP v1 API (free tier) + APNs HTTP/2.

## Deep links

Capacitor supports universal links / app links out of the box. Recommended scheme:

- `https://clanchat.app/u/<handle>` → opens Profile
- `https://clanchat.app/p/<post_id>` → opens Post
- `clanchat://t/<tag>` → opens TagView

Configure in `capacitor.config.js` under `server.androidScheme` and the iOS
Associated Domains entitlement.

## Build & ship

```bash
# iOS — open in Xcode, sign with team, archive, upload to App Store Connect
npx cap open ios

# Android — open in Android Studio, signed APK / AAB for Play Console
npx cap open android
```

## Estimated effort to ship

| Step                              | Time     |
|-----------------------------------|----------|
| Capacitor install + first sync    | 30 min   |
| Auth → bearer token migration     | 2 hours  |
| Push notifications wiring         | 4 hours  |
| Deep links                        | 1 hour   |
| App icons / splash assets         | 1 hour   |
| Beta builds → TestFlight + Play   | 1 hour   |
| Store listings + screenshots      | 2 hours  |
| **Total**                         | ~1.5 days|

App Store / Play Store review queues add 1–3 days of waiting on top.
