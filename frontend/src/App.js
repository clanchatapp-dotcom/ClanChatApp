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
import TagApprovals from "./pages/TagApprovals";
import MyConnections from "./pages/MyConnections";
import Install from "./pages/Install";
import { Toaster } from "sonner";

function Protected({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === undefined) return <div className="p-10 text-zinc-500 text-sm">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

function AppRouter() {
  // Sync session_id handler at the top level (synchronous detection)
  if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
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
        <Route path="/inner" element={<Protected><InnerCircle /></Protected>} />
        <Route path="/groups" element={<Protected><Groups /></Protected>} />
        <Route path="/g/:groupId" element={<Protected><GroupChat /></Protected>} />
        <Route path="/admin" element={<Protected><Admin /></Protected>} />
        <Route path="/admin/watch/:userId" element={<Protected><AdminWatch /></Protected>} />
        <Route path="/tags" element={<Protected><TagApprovals /></Protected>} />
        <Route path="/me/:kind" element={<Protected><MyConnections /></Protected>} />
        <Route path="/install" element={<Install />} />
        <Route path="/b/:boardId" element={<Protected><BoardView /></Protected>} />
        <Route path="/t/:tag" element={<Protected><TagView /></Protected>} />
        <Route path="*" element={<Navigate to="/feed" replace />} />
      </Route>
    </Routes>
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
