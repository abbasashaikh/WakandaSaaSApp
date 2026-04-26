// src/renderer/pages/DashboardPage.jsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { logout, checkHealth } from '../api'

function NavCard({ onClick, icon, title, description, color }) {
  return (
    <button onClick={onClick}
      className={`group w-full p-6 rounded-2xl border text-left transition-all duration-200
        hover:scale-[1.02] active:scale-[0.99]
        ${color === 'blue'
          ? 'bg-dark-800 border-dark-600 hover:border-blue-500/50 hover:bg-dark-750'
          : 'bg-dark-800 border-dark-600 hover:border-purple-500/50 hover:bg-dark-750'
        }`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4
        ${color === 'blue' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
        {icon}
      </div>
      <h3 className="text-white font-semibold text-lg mb-1">{title}</h3>
      <p className="text-gray-400 text-sm">{description}</p>
    </button>
  )
}

export default function DashboardPage() {
  const navigate        = useNavigate()
  const user            = useAppStore(s => s.user)
  const clearUser       = useAppStore(s => s.clearUser)
  const sessionWarning  = useAppStore(s => s.sessionWarning)
  const setSessionWarning = useAppStore(s => s.setSessionWarning)

  // Phase 8: Check server health on mount
  useEffect(() => {
    checkHealth().then(h => {
      if (!h) {
        setSessionWarning('Cannot reach the backend server. Make sure npm start is running.')
      }
    })
  }, [setSessionWarning])

  async function handleLogout() {
    await logout()
    clearUser()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-dark-900 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-dark-700">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-brand-500
                          flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813
                   a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12z"/>
            </svg>
          </div>
          <span className="text-white font-semibold text-sm">AI Creative Studio</span>
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <span className="text-gray-400 text-sm">{user.email || user.name}</span>
          )}
          <button onClick={() => navigate('/history')}
            className="p-2 rounded-lg hover:bg-dark-700 text-gray-400 hover:text-white transition-colors"
            title="History">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 6v6h4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </button>
          <button onClick={handleLogout}
            className="p-2 rounded-lg hover:bg-dark-700 text-gray-400 hover:text-white transition-colors"
            title="Sign out">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6
                   a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Session warning banner (Phase 8) */}
      {sessionWarning && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5
                        flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none"
                 stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71
                   c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z
                   M12 15.75h.007v.008H12v-.008z"/>
            </svg>
            <span className="text-amber-300 text-sm">{sessionWarning}</span>
          </div>
          <button onClick={() => setSessionWarning(null)}
            className="text-amber-400 hover:text-amber-300 ml-4">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <h1 className="text-3xl font-semibold text-white mb-2">
          What will you create?
        </h1>
        <p className="text-gray-400 mb-10">Choose a generation type to get started</p>

        <div className="grid grid-cols-2 gap-4 w-full max-w-xl">
          <NavCard
            onClick={() => navigate('/image')}
            color="blue"
            title="AI Image"
            description="Generate stunning images from a text prompt"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5
                     l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0
                     001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0
                     001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0
                     .375.375 0 01.75 0z"/>
              </svg>
            }
          />

          <NavCard
            onClick={() => navigate('/video')}
            color="purple"
            title="AI Video"
            description="Create short videos from a text description"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53
                     l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0
                     00-2.25-2.25h-9A2.25 2.25 0 002.25 9.75v9A2.25 2.25 0 004.5 18.75z"/>
              </svg>
            }
          />
        </div>

        {/* Quick history row */}
        <div className="mt-10">
          <button onClick={() => navigate('/history')}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-300 transition-colors text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 6v6h4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            View generation history
          </button>
        </div>
      </div>
    </div>
  )
}
