// src/renderer/pages/AuthPage.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { validateKey } from '../api'

export default function AuthPage() {
  const navigate = useNavigate()
  const setAuth = useAppStore((s) => s.setAuth)

  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleActivate(e) {
    e.preventDefault()
    const trimmed = key.trim()
    if (!trimmed) return

    setLoading(true)
    setError('')

    try {
      const data = await validateKey(trimmed)
      if (data.valid) {
        setAuth(trimmed, data.user, data.subscription)
        navigate('/dashboard')
      } else {
        setError('Invalid or expired license key.')
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error
      if (err?.response?.status === 401) {
        setError('Invalid or expired license key.')
      } else if (err?.code === 'ECONNREFUSED' || err?.code === 'ERR_NETWORK') {
        setError('Cannot reach server. Make sure the backend is running on port 3001.')
      } else {
        setError(msg || 'Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  function openSite() {
    window.electronAPI?.openExternal('https://yoursite.com') ||
      window.open('https://yoursite.com', '_blank')
  }

  return (
    <div className="min-h-screen bg-dark-900 flex items-center justify-center p-4">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-radial from-brand-900/20 via-transparent to-transparent pointer-events-none" />

      <div className="relative w-full max-w-md animate-slide-up">
        {/* Card */}
        <div className="bg-dark-800 border border-dark-500 rounded-2xl p-8 shadow-2xl">

          {/* Logo / Brand */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg shadow-brand-500/25">
              <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">YourBrand</h1>
            <p className="text-dark-400 text-sm mt-1">AI Creative Studio</p>
          </div>

          {/* Form */}
          <form onSubmit={handleActivate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                License Key
              </label>
              <input
                type="text"
                value={key}
                onChange={(e) => { setKey(e.target.value); setError('') }}
                placeholder="Enter your API license key"
                className="w-full bg-dark-700 border border-dark-400 rounded-xl px-4 py-3 text-white placeholder-dark-300
                           focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
                           transition-all duration-200 font-mono text-sm"
                autoFocus
                spellCheck={false}
              />
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 animate-fade-in">
                <svg className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !key.trim()}
              className="w-full bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500
                         disabled:opacity-50 disabled:cursor-not-allowed
                         text-white font-semibold py-3 px-6 rounded-xl
                         transition-all duration-200 flex items-center justify-center gap-2
                         shadow-lg shadow-brand-500/25"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Activating...
                </>
              ) : (
                <>
                  Activate
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </form>

          {/* Footer link */}
          <div className="mt-6 text-center">
            <button
              onClick={openSite}
              className="text-sm text-dark-300 hover:text-brand-400 transition-colors duration-200"
            >
              Don't have a key?{' '}
              <span className="text-brand-400 underline underline-offset-2">Get access at yoursite.com</span>
            </button>
          </div>
        </div>

        {/* Version */}
        <p className="text-center text-dark-400 text-xs mt-4">v0.1.0-poc</p>
      </div>
    </div>
  )
}
