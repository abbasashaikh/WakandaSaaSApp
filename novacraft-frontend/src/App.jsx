import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import LandingPage       from './pages/LandingPage'
import LoginPage         from './pages/LoginPage'
import RegisterPage      from './pages/RegisterPage'
import DashboardPage     from './pages/DashboardPage'
import PlansPage         from './pages/PlansPage'
import PaymentUploadPage from './pages/PaymentUploadPage'
import AdminLoginPage    from './pages/admin/AdminLoginPage'
import AdminDashboardPage from './pages/admin/AdminDashboardPage'

function Protected({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return <div className="flex items-center justify-center h-screen" style={{background:'#0A0B1A'}}><div className="w-8 h-8 border-2 border-pink rounded-full border-t-transparent animate-spin" /></div>
  return user ? children : <Navigate to="/login" replace />
}

function AdminProtected({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return null
  return (user?.isAdmin) ? children : <Navigate to="/admin" replace />
}

export default function App() {
  const init = useAuthStore(s => s.init)
  useEffect(() => { init() }, [init])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"           element={<LandingPage />} />
        <Route path="/login"      element={<LoginPage />} />
        <Route path="/register"   element={<RegisterPage />} />
        <Route path="/dashboard"  element={<Protected><DashboardPage /></Protected>} />
        <Route path="/plans"      element={<Protected><PlansPage /></Protected>} />
        <Route path="/payment/:plan" element={<Protected><PaymentUploadPage /></Protected>} />
        <Route path="/admin"      element={<AdminLoginPage />} />
        <Route path="/admin/dashboard" element={<AdminProtected><AdminDashboardPage /></AdminProtected>} />
        <Route path="*"           element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
