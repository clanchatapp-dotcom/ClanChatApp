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
    // `frontend/build/` (no remote URL). The WebView origin is
    // `https://localhost`, so we use bearer tokens for auth (see
    // frontend/src/lib/api.js) — cookies can't be shared across origins
    // with the clanchat.app backend.
    //
    // For login to work, the production backend at clanchat.app MUST have
    // the updated CORS regex that allows `https://localhost` (added in
    // server.py). Redeploy the backend before installing a new APK or
    // logins will fail with "Disallowed CORS origin".
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
