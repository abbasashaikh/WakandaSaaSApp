// src/renderer/App.jsx — React Router with auth guard
import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from './store/appStore'

import LoginPage     from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ImagePage     from './pages/ImagePage'
import VideoPage     from './pages/VideoPage'
import HistoryPage   from './pages/HistoryPage'

// ── Auth guard wrapper ────────────────────────────────────────────────────────
function RequireAuth({ children }) {
  const isLoggedIn  = useAppStore(s => s.isLoggedIn)
  const authChecked = useAppStore(s => s.authChecked)
  const location    = useLocation()

  if (!authChecked) {
    // Still checking — show spinner
    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center">
        <svg className="animate-spin w-10 h-10 text-purple-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      </div>
    )
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}

// ── Bootstrap: check auth on mount ───────────────────────────────────────────
function AuthBootstrap() {
  const checkAuth  = useAppStore(s => s.checkAuth)
  const navigate   = useNavigate()
  const location   = useLocation()

  useEffect(() => {
    checkAuth().then(ok => {
      // If on login page and already authenticated, go to dashboard
      if (ok && location.pathname === '/login') {
        navigate('/', { replace: true })
      }
    })
  }, []) // run once on mount

  return null
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <>
      <AuthBootstrap />
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected */}
        <Route path="/" element={
          <RequireAuth><DashboardPage /></RequireAuth>
        } />
        <Route path="/dashboard" element={
          <RequireAuth><DashboardPage /></RequireAuth>
        } />
        <Route path="/image" element={
          <RequireAuth><ImagePage /></RequireAuth>
        } />
        <Route path="/video" element={
          <RequireAuth><VideoPage /></RequireAuth>
        } />
        <Route path="/history" element={
          <RequireAuth><HistoryPage /></RequireAuth>
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
