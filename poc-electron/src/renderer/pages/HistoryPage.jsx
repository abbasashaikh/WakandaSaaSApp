// src/renderer/pages/HistoryPage.jsx — Phase 7: Job history
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getJobHistory, friendlyError } from '../api'
import { useAppStore } from '../store/appStore'

const STATUS_COLOR = {
  completed:  'text-green-400',
  failed:     'text-red-400',
  processing: 'text-yellow-400',
  queued:     'text-blue-400',
}

function formatAge(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ago`
  if (h > 0) return `${h}h ago`
  if (m > 0) return `${m}m ago`
  return 'just now'
}

export default function HistoryPage() {
  const navigate  = useNavigate()
  const history   = useAppStore(s => s.history)
  const setHistory = useAppStore(s => s.setHistory)

  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [preview, setPreview] = useState(null) // { url, type }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getJobHistory(30)
      setHistory(data.jobs || [])
    } catch (err) {
      setError(friendlyError(err.message))
    } finally {
      setLoading(false)
    }
  }, [setHistory])

  useEffect(() => { load() }, [load])

  function reusePrompt(job) {
    const route = job.type === 'video' ? '/video' : '/'
    navigate(route, { state: { prompt: job.prompt } })
  }

  const API_BASE = 'http://localhost:3001'
  function resolveUrl(url) {
    if (!url) return null
    if (url.startsWith('/media/')) return `${API_BASE}${url}`
    return url
  }

  return (
    <div className="flex flex-col h-screen bg-dark-900">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-dark-700 flex-shrink-0">
        <button onClick={() => navigate(-1)}
          className="p-2 rounded-lg hover:bg-dark-700 text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="text-white font-semibold">Generation history</h1>
        <div className="flex-1"/>
        <button onClick={load}
          className="p-2 rounded-lg hover:bg-dark-700 text-gray-400 hover:text-white transition-colors"
          title="Refresh">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-3.36M20 15a9 9 0 01-14.13 3.36"/>
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex justify-center py-16">
            <svg className="animate-spin w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && history.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
            </svg>
            <p>No generations yet</p>
          </div>
        )}

        {!loading && history.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {history.map(job => {
              const url = resolveUrl(job.output_url)
              return (
                <div key={job.job_id}
                  className="bg-dark-800 rounded-xl overflow-hidden border border-dark-700
                             hover:border-dark-500 transition-colors group">

                  {/* Thumbnail */}
                  <div className="aspect-video bg-dark-700 relative">
                    {url && job.status === 'completed' ? (
                      job.type === 'video'
                        ? <video src={url} className="w-full h-full object-cover"
                            muted playsInline preload="metadata"
                            onMouseEnter={e => e.target.play()}
                            onMouseLeave={e => { e.target.pause(); e.target.currentTime = 0 }}/>
                        : <img src={url} alt={job.prompt}
                            className="w-full h-full object-cover cursor-pointer"
                            onClick={() => setPreview({ url, type: job.type })}/>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className={`text-xs font-medium ${STATUS_COLOR[job.status] || 'text-gray-400'}`}>
                          {job.status}
                        </span>
                      </div>
                    )}

                    {/* Type badge */}
                    <div className="absolute top-2 left-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                        ${job.type === 'video'
                          ? 'bg-purple-500/20 text-purple-300'
                          : 'bg-blue-500/20 text-blue-300'}`}>
                        {job.type}
                      </span>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    <p className="text-white text-xs leading-relaxed line-clamp-2 mb-2">
                      {job.prompt}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-xs">{formatAge(job.created_at)}</span>
                      {job.status === 'completed' && (
                        <button onClick={() => reusePrompt(job)}
                          className="text-xs text-purple-400 hover:text-purple-300 transition-colors
                                     opacity-0 group-hover:opacity-100">
                          Reuse prompt
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Full-screen image preview */}
      {preview && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50"
          onClick={() => setPreview(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-dark-800 text-white hover:bg-dark-700"
            onClick={() => setPreview(null)}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
          <img src={preview.url} alt="" className="max-h-screen max-w-screen object-contain"
            onClick={e => e.stopPropagation()}/>
        </div>
      )}
    </div>
  )
}
