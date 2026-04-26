// src/renderer/pages/LoginPage.jsx — Phase 5: JWT login
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../api'
import { useAppStore } from '../store/appStore'

export default function LoginPage() {
  const navigate     = useNavigate()
  const setUser      = useAppStore(s => s.setUser)
  const [key, setKey]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    if (!key.trim()) return
    setLoading(true)
    setError('')
    try {
      const user = await login(key.trim())
      setUser(user)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Invalid license key')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900 p-6">
      <div className="w-full max-w-sm">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-brand-500
                          flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813
                   a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813
                   a4.5 4.5 0 00-3.09 3.09z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-white">AI Creative Studio</h1>
          <p className="text-gray-400 text-sm mt-1">Enter your license key to continue</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">License key</label>
            <input
              type="text"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="poc-test-key-12345678"
              autoFocus
              className="w-full bg-dark-700 border border-dark-500 rounded-xl px-4 py-3
                         text-white placeholder-gray-600 text-sm
                         focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30
                         transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !key.trim()}
            className="w-full bg-gradient-to-r from-purple-600 to-brand-600
                       hover:from-purple-500 hover:to-brand-500
                       disabled:opacity-50 disabled:cursor-not-allowed
                       text-white font-medium py-3 rounded-xl
                       transition-all duration-200 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Signing in…
              </>
            ) : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
