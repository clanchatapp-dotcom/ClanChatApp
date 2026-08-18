import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import "./App.css";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { getSupabase } from "./lib/supabase";
import { toast } from "sonner";
import AppShell from "./components/AppShell";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import AuthCallback from "./pages/AuthCallback";
import Feed from "./pages/Feed";
import NewPost from "./pages/NewPost";
import Search from "./pages/Search";
import { Messages, MessageThread } from "./pages/Messages";
import Profile from "./pages/Profile";
import EditProfile from "./pages/EditProfile";
import Settings from "./pages/Settings";
import Notifications from "./pages/Notifications";
import InnerCircle from "./pages/InnerCircle";
import BoardView from "./pages/BoardView";
import TagView from "./pages/TagView";
import { Groups, GroupChat } from "./pages/Groups";
import Admin from "./pages/Admin";
import AdminWatch from "./pages/AdminWatch";
import AdminShowcase from "./pages/AdminShowcase";
import Call from "./pages/Call";
import ForgotPassword from "./pages/ForgotPassword";
import TagApprovals from "./pages/TagApprovals";
import MyConnections from "./pages/MyConnections";
import Connections from "./pages/Connections";
import MyReports from "./pages/MyReports";
import MyComments from "./pages/MyComments";
import Install from "./pages/Install";
import CompleteProfile from "./pages/CompleteProfile";
import { Toaster } from "sonner";

// True while a Google OAuth redirect is mid-flight (?code= still in the URL).
const oauthCodePending = () => {
  try { return new URLSearchParams(window.location.search).has("code"); }
  catch { return false; }
};

function Protected({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === undefined) return <div className="p-10 text-zinc-500 text-sm">Loading…</div>;
  // Don't bounce to /login while we're still exchanging an OAuth ?code= that
  // landed on this protected route — that bounce was dropping the code and
  // causing the Google sign-in loop. Wait for the exchange to set the user.
  if (!user && oauthCodePending()) {
    return <div className="p-10 text-zinc-500 text-sm">Signing you in…</div>;
  }
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

// Root-level handler for the Google OAuth web redirect. Google returns to
// /feed?code=… (PKCE); we exchange it here at the app root so it works no
// matter which route it lands on, then clean the URL. AuthContext's
// onSupabaseAuth picks up SIGNED_IN and swaps the session for a ClanChat JWT.
// On a bad/expired verifier we surface an error and restart the flow once.
function useOAuthReturn() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthError = params.get("error_description") || params.get("error");
    const clean = () => {
      try { window.history.replaceState({}, "", window.location.pathname); } catch { /* ignore */ }
    };
    if (oauthError) { clean(); toast.error(`Google sign-in failed: ${oauthError}`); return; }
    if (!code) return;
    (async () => {
      try {
        const supa = await getSupabase();
        await supa.auth.exchangeCodeForSession(code);
        clean();
        sessionStorage.removeItem("cc_oauth_retry");
      } catch (e) {
        clean();
        const msg = (e?.message || "").toLowerCase();
        const verifierIssue =
          msg.includes("verifier") || msg.includes("pkce") ||
          msg.includes("code challenge") || msg.includes("invalid request") ||
          msg.includes("auth code and code verifier");
        if (verifierIssue && !sessionStorage.getItem("cc_oauth_retry")) {
          sessionStorage.setItem("cc_oauth_retry", "1");
          toast.message("Reconnecting to Google…");
          try {
            const { getSupabase: gs } = await import("./lib/supabase");
            const s = await gs();
            const { data } = await s.auth.signInWithOAuth({
              provider: "google",
              options: { redirectTo: `${window.location.origin}/feed` },
            });
            if (data?.url) window.location.href = data.url;
            return;
          } catch { /* fall through */ }
        }
        sessionStorage.removeItem("cc_oauth_retry");
        toast.error("Google sign-in didn't complete. Please tap Continue with Google again.");
      }
    })();
  }, []);
}

function AppRouter() {
  const { pendingProfile } = useAuth();
  useOAuthReturn();
  // Sync session_id handler at the top level (synchronous detection)
  if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <>
      {pendingProfile && <CompleteProfile />}
      <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/register" element={<Register />} />
        <Route path="/feed" element={<Protected><Feed /></Protected>} />
        <Route path="/compose" element={<Protected><NewPost /></Protected>} />
        <Route path="/search" element={<Protected><Search /></Protected>} />
        <Route path="/messages" element={<Protected><Messages /></Protected>} />
        <Route path="/m/:userId" element={<Protected><MessageThread /></Protected>} />
        <Route path="/me" element={<Protected><Profile /></Protected>} />
        <Route path="/u/:handle" element={<Protected><Profile /></Protected>} />
        <Route path="/edit-profile" element={<Protected><EditProfile /></Protected>} />
        <Route path="/settings" element={<Protected><Settings /></Protected>} />
        <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
        <Route path="/me/comments" element={<Protected><MyComments /></Protected>} />
        <Route path="/inner" element={<Protected><InnerCircle /></Protected>} />
        <Route path="/groups" element={<Protected><Groups /></Protected>} />
        <Route path="/g/:groupId" element={<Protected><GroupChat /></Protected>} />
        <Route path="/admin" element={<Protected><Admin /></Protected>} />
        <Route path="/admin/showcase" element={<Protected><AdminShowcase /></Protected>} />
        <Route path="/call/:callId" element={<Protected><Call /></Protected>} />
        <Route path="/admin/watch/:userId" element={<Protected><AdminWatch /></Protected>} />
        <Route path="/tags" element={<Protected><TagApprovals /></Protected>} />
        <Route path="/me/reports" element={<Protected><MyReports /></Protected>} />
        <Route path="/connections" element={<Protected><Connections /></Protected>} />
        <Route path="/me/:kind" element={<Protected><MyConnections /></Protected>} />
        <Route path="/install" element={<Install />} />
        <Route path="/b/:boardId" element={<Protected><BoardView /></Protected>} />
        <Route path="/t/:tag" element={<Protected><TagView /></Protected>} />
        <Route path="*" element={<Navigate to="/feed" replace />} />
      </Route>
    </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster theme="dark" position="top-center" toastOptions={{ style: { background: "#18181B", color: "#FAFAFA", border: "1px solid #27272A" } }} />
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  );
}
