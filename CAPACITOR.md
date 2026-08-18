# ClanChat — Native APK Build Guide

## TL;DR for testers

1. Go to the repo's **Actions** tab on GitHub.
2. Click the latest successful **Build Android APK** run.
3. Download the **`ClanChat-debug-apk`** artifact (~10 MB zip → `ClanChat-debug.apk` inside).
4. Open the APK on the Android phone. If Android warns about an unknown source, allow it for your browser or file manager. Install.
5. Open ClanChat — it logs you in to the live production data at https://clanchat.app.

## How it works

This repo's GitHub Actions workflow at `.github/workflows/android-apk.yml` builds a debug-signed APK on every push to `main` (and any manual trigger via the **Run workflow** button). The APK is a thin Capacitor shell wrapping the React web app — same code that ships to https://clanchat.app, same data.

- App ID: `app.clanchat.mobile`
- Display name: **ClanChat**
- Launcher icon: brand shield-and-sword from `frontend/android-resources/`
- Splash + status bar: true-black

## How to ship a new build

```bash
# 1. Make code changes in this repo (or via Emergent → Save to GitHub)
# 2. Push to main
git push origin main

# 3. GitHub Actions auto-runs (~6-8 minutes total)
#    Watch progress at: https://github.com/<you>/<repo>/actions

# 4. Once green, download the artifact. Distribute to testers.
```

## Local Android Studio build (alternative)

If you want to iterate locally with Android Studio:

```bash
cd frontend
yarn install
yarn build
npx cap add android        # first time only
npx cap sync android
# Copy launcher icons (first time only):
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  cp android-resources/mipmap-$d/ic_launcher.png         android/app/src/main/res/mipmap-$d/
  cp android-resources/mipmap-$d/ic_launcher_round.png   android/app/src/main/res/mipmap-$d/
  cp android-resources/mipmap-$d/ic_launcher_foreground.png android/app/src/main/res/mipmap-$d/
done
npx cap open android       # opens Android Studio
```

## iOS build (Mac required)

```bash
cd frontend
yarn add @capacitor/ios
yarn build
npx cap add ios
npx cap sync ios
npx cap open ios           # opens Xcode — sign with your team, archive, distribute via TestFlight
```

## Auth — current state & migration plan

The APK loads `https://clanchat.app` directly. Cookies set by login on that domain are stored in the Capacitor WebView's cookie jar, so sessions persist across app launches the same way they do in a phone browser.

**This works today.** If you ever notice testers getting logged out on cold launch, that's the trigger to migrate to bearer tokens:

1. Add `POST /api/auth/login-bearer` that returns `{ access_token }` in body (same JWT, just not in a cookie).
2. On native, store the token via `@capacitor/preferences` (encrypted keychain / EncryptedSharedPreferences).
3. Update `frontend/src/lib/api.js` axios interceptor to attach `Authorization: Bearer <token>` when `Capacitor.isNativePlatform()` is true.
4. Comment out the `server.url` block in `capacitor.config.js` so the bundled `build/` ships instead.

## Push notifications (deferred)

Not in the testing APK. Hook-up path:

```bash
yarn add @capacitor/push-notifications
```

Backend needs a `device_tokens` collection + a worker that fires FCM/APNs on new follow/IC accept/new DM/new group message/tag approved/strike issued. Roughly 4 hours of work when you're ready.

## Deep links (deferred)

Out of scope for testing APK. When you want them:

- `https://clanchat.app/u/<handle>` → Profile (works today via in-app navigation)
- `clanchat://p/<post_id>` → Post detail
- Configure via Android `intent-filter` in `AndroidManifest.xml` and iOS Associated Domains entitlement.

## Estimated time to App Store + Play Store

| Step                                      | Time     |
|-------------------------------------------|----------|
| GitHub Actions APK (already done)         | ✅ 0     |
| Auth → bearer token migration             | 2 hours  |
| Push notifications wiring                 | 4 hours  |
| Deep links                                | 1 hour   |
| iOS first build (TestFlight beta)         | 1 hour   |
| Play Console signed AAB + listing         | 2 hours  |
| Store review queues                       | 1–3 days |
| **Total active work**                     | ~1.5 days|
