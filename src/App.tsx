import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Login from './pages/Login'
import Chat from './pages/Chat'
import AuthCallback from './pages/AuthCallback'

export default function App() {
  const { user, loading } = useAuth()

  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/"
        element={
          loading ? (
            <div className="h-full grid place-items-center text-slate-400">Loading…</div>
          ) : user ? (
            <Chat />
          ) : (
            <Login />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
