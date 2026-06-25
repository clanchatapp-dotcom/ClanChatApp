// Capacitor configuration for ClanChat native app wrapping.
// This file is the bridge between the existing React web app and native
// iOS / Android shells. Build steps documented in /app/CAPACITOR.md.

const config = {
  appId: "app.clanchat.mobile",
  appName: "ClanChat",
  webDir: "build",
  bundledWebRuntime: false,
  server: {
    // For local dev against the live preview, point here. In production builds
    // we ship the bundled `build/` directory and this is unused.
    // androidScheme: "https",
    // url: "https://private-posts-11.preview.emergentagent.com",
    // cleartext: false,
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#000000",
  },
  android: {
    backgroundColor: "#000000",
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#000000",
      androidSplashResourceName: "splash",
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
