import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";

// Canonicalize the web host to https://clanchat.app BEFORE anything else.
// PKCE OAuth must start and finish on the SAME origin (the code-verifier is
// stored per-origin), so users on www.clanchat.app or the *.emergent.host
// alias must be moved to the canonical apex domain before signing in — else
// the verifier written on one host can't be read on the other and Google
// sign-in fails. Preview (*.preview.emergentagent.com) is left untouched.
(function canonicalizeHost() {
  try {
    const h = window.location.hostname;
    if (h === "www.clanchat.app" || h.endsWith(".emergent.host")) {
      window.location.replace(
        "https://clanchat.app" + window.location.pathname + window.location.search + window.location.hash
      );
    }
  } catch { /* non-browser env */ }
})();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

// Register the PWA service worker. Only in production builds (webpack sets
// NODE_ENV) and only when the browser supports it — Capacitor's WebView
// serves the app from `file://` on Android where SW registration silently
// no-ops.
if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("SW register failed", err));
  });
}
