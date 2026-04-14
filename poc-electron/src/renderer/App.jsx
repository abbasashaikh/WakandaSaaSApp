// src/renderer/App.jsx — Root component with routing
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAppStore } from './store/appStore'

import AuthPage      from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'
import ImagePage     from './pages/ImagePage'
import VideoPage     from './pages/VideoPage'

// Guard: redirect to /auth if not authenticated
function ProtectedRoute({ children }) {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/auth" replace />
  return children
}

// Guard: redirect to /dashboard if already authenticated
function GuestRoute({ children }) {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/auth" replace />} />

      <Route path="/auth" element={
        <GuestRoute>
          <AuthPage />
        </GuestRoute>
      } />

      <Route path="/dashboard" element={
        <ProtectedRoute>
          <DashboardPage />
        </ProtectedRoute>
      } />

      <Route path="/image" element={
        <ProtectedRoute>
          <ImagePage />
        </ProtectedRoute>
      } />

      <Route path="/video" element={
        <ProtectedRoute>
          <VideoPage />
        </ProtectedRoute>
      } />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
