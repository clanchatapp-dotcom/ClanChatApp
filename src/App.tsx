import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Feed from './pages/Feed'
import Profile from './pages/Profile'
import Messages from './pages/Messages'
import SearchPage from './pages/Search'
import Activity from './pages/Activity'
import AuthCallback from './pages/AuthCallback'
import { Loader2 } from 'lucide-react'

export default function App() {
  const { user, loading } = useAuth()

  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      {loading ? (
        <Route path="*" element={<div className="h-full grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>} />
      ) : !user ? (
        <Route path="*" element={<Login />} />
      ) : (
        <Route element={<Layout />}>
          <Route path="/" element={<Feed />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/messages/:handle" element={<Messages />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/u/:handle" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  )
}
