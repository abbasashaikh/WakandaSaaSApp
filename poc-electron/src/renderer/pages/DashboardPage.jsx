// src/renderer/pages/DashboardPage.jsx
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'

function ToolCard({ icon, title, description, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group relative bg-dark-800 border border-dark-500 hover:border-brand-500/50
                 rounded-2xl p-8 text-left transition-all duration-300
                 hover:bg-dark-700 hover:shadow-xl hover:shadow-brand-500/10
                 hover:-translate-y-1 active:translate-y-0"
    >
      {/* Glow on hover */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-brand-500/5 to-purple-500/5
                      opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

      <div className="relative">
        {/* Icon */}
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-brand-500/20 to-purple-500/20
                        border border-brand-500/20 flex items-center justify-center mb-5
                        group-hover:from-brand-500/30 group-hover:to-purple-500/30 transition-all duration-300">
          {icon}
        </div>

        {/* Badge */}
        {badge && (
          <span className="absolute top-0 right-0 text-xs bg-brand-500/20 text-brand-300
                           border border-brand-500/30 px-2 py-1 rounded-full font-medium">
            {badge}
          </span>
        )}

        <h3 className="text-white font-bold text-xl mb-2">{title}</h3>
        <p className="text-gray-400 text-sm leading-relaxed mb-6">{description}</p>

        <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm
                        group-hover:gap-3 transition-all duration-200">
          Open
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </div>
      </div>
    </button>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user, subscription, clearAuth } = useAppStore()

  function handleSignOut() {
    clearAuth()
    navigate('/auth')
  }

  const daysColor = (subscription?.days_remaining || 0) > 7
    ? 'text-green-400'
    : 'text-yellow-400'

  return (
    <div className="min-h-screen bg-dark-900 flex flex-col">

      {/* Header */}
      <header className="bg-dark-800 border-b border-dark-500 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <span className="text-white font-semibold">YourBrand</span>
          </div>

          {/* User info */}
          <div className="flex items-center gap-4">
            <span className="text-gray-400 text-sm hidden md:block">
              {user?.email}
            </span>

            {subscription && (
              <>
                <span className="bg-green-500/15 text-green-400 border border-green-500/30
                                 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                  {subscription.badge}
                </span>
                <span className={`text-sm font-medium ${daysColor}`}>
                  {subscription.days_remaining}d left
                </span>
              </>
            )}

            <button
              onClick={handleSignOut}
              className="text-sm text-gray-400 hover:text-white transition-colors duration-200
                         bg-dark-600 hover:bg-dark-500 px-3 py-1.5 rounded-lg border border-dark-400"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="max-w-3xl w-full animate-slide-up">

          {/* Greeting */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-white mb-3">
              Choose Your Tool
            </h1>
            <p className="text-gray-400 text-lg">
              Create stunning AI-generated images and videos
            </p>
          </div>

          {/* Tool cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ToolCard
              onClick={() => navigate('/image')}
              icon={
                <svg className="w-7 h-7 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18a.75.75 0 01.75.75v16.5a.75.75 0 01-.75.75H3a.75.75 0 01-.75-.75V3.75A.75.75 0 013 3z" />
                </svg>
              }
              title="AI Image Generation"
              description="Generate stunning images from text descriptions. Supports multiple aspect ratios and styles."
              badge="Instant"
            />

            <ToolCard
              onClick={() => navigate('/video')}
              icon={
                <svg className="w-7 h-7 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 9.75v9A2.25 2.25 0 004.5 18.75z" />
                </svg>
              }
              title="AI Video Generation"
              description="Create short AI-powered videos from prompts. Choose 4s or 8s duration in Fast or HD quality."
              badge="1–2 min"
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-dark-400 text-xs border-t border-dark-700">
        YourBrand • v0.1.0-poc
      </footer>
    </div>
  )
}
