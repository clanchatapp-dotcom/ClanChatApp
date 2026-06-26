// Capacitor configuration for ClanChat native app wrapping.
// This file is the bridge between the existing React web app and native
// iOS / Android shells. Build steps documented in /app/CAPACITOR.md.
// The GitHub Actions workflow at .github/workflows/android-apk.yml uses
// this config to produce a debug APK on every push to main.

const config = {
  appId: "app.clanchat.mobile",
  appName: "ClanChat",
  webDir: "build",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https",
    // Self-contained mode: the APK loads the bundled React build from
    // `frontend/build/` instead of fetching the live web app from
    // clanchat.app every time it opens. This means UI updates ship with
    // each new APK and the app works fully offline (apart from API calls).
    // Auth uses bearer tokens (see frontend/src/lib/api.js) because the
    // Capacitor WebView origin is `https://localhost`, which can't share
    // cookies with the `clanchat.app` backend.
    cleartext: false,
  },
  android: {
    backgroundColor: "#000000",
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#000000",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#000000",
    },
    // IMPORTANT: PrivacyScreen defaults to enable:true which sets FLAG_SECURE
    // on the whole app from launch — that's what blocks screenshots across
    // every screen and breaks the file picker. We default it OFF, then
    // selectively call PrivacyScreen.enable() ONLY when the user opens a DM
    // thread where both parties haven't opted into screenshots.
    PrivacyScreen: {
      enable: false,
      preventScreenshots: false,
    },
  },
};

module.exports = config;
