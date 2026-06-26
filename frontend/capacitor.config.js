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
    // Until we ship a bearer-token auth migration (see CAPACITOR.md), the
    // native APK loads the production web app directly so cookies & login
    // continue to work seamlessly. Once auth migrates to tokens, comment
    // these out and Capacitor will load the bundled `build/` directory.
    url: "https://clanchat.app",
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
  },
};

module.exports = config;
