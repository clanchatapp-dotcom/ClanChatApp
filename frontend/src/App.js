import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import "./App.css";
import { AuthProvider, useAuth } from "./context/AuthContext";
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

// Route guard.
//
// Two states now block a redirect instead of one:
//   * bootstrapping  – AuthContext's single startup sequence (OAuth code
//                      exchange -> Supabase session -> /auth/me) hasn't
//                      finished, so `user` is not yet trustworthy.
//   * user === undefined – nothing hydrated yet.
//
// The old version redirected as soon as `user` was null, which happened
// mid-OAuth and mid-/auth/me, producing the /feed -> /login -> /feed
// flicker. It also sniffed `?code=` from the URL, but the code was stripped
// by the exchange before this ever ran, so the guard silently stopped
// working. `bootstrapping` is state, not a URL read, so it can't go stale.
function Protected({ children }) {
  const { user, bootstrapping } = useAuth();
  const loc = useLocation();
  if (bootstrapping || user === undefined) {
    return <div className="p-10 text-zinc-500 text-sm">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

function AppRouter() {
  const { pendingProfile, bootstrapping } = useAuth();
  // Sync session_id handler at the top level (synchronous detection)
  if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  // Hold the whole tree on one stable splash until auth has settled. Without
  // this the public routes (Landing / Login) mount, then unmount the instant
  // the session lands — that mount/unmount pair is the flicker users saw
  // right after tapping "Continue with Google".
  if (bootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500 text-sm">
        <div className="animate-pulse">Loading…</div>
      </div>
    );
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
