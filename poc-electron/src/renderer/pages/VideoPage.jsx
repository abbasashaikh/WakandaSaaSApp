// src/renderer/pages/VideoPage.jsx
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { generateVideo, startPolling } from '../api'

// ─── Sub-components ───────────────────────────────────────────

function VideoProgress({ elapsed }) {
  const percent = Math.min((elapsed / 90) * 100, 95) // Cap at 95% until done

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-6 p-8">
      {/* Animated icon */}
      <div className="relative">
        <div className="w-20 h-20 rounded-full border-2 border-dark-500 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full border-2 border-brand-500/30 animate-ping absolute" />
          <svg className="w-9 h-9 text-brand-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 9.75v9A2.25 2.25 0 004.5 18.75z" />
          </svg>
        </div>
      </div>

      <div className="text-center">
        <p className="text-white font-semibold text-lg mb-1">Generating video...</p>
        <p className="text-gray-400 text-sm">This may take 1–2 minutes</p>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-sm">
        <div className="flex justify-between text-xs text-gray-500 mb-2">
          <span>Processing</span>
          <span>{Math.round(percent)}%</span>
        </div>
        <div className="h-2 bg-dark-600 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand-500 to-purple-500 rounded-full transition-all duration-1000"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 text-right mt-1">{elapsed}s elapsed</p>
      </div>
    </div>
  )
}

function EmptyCanvas() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 select-none">
      <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-dark-400 flex items-center justify-center">
        <svg className="w-8 h-8 text-dark-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 9.75v9A2.25 2.25 0 004.5 18.75z" />
        </svg>
      </div>
      <p className="text-dark-300 text-sm">Enter a prompt to generate a video</p>
    </div>
  )
}

function VideoResult({ url, onDownload }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-4">
      <video
        src={url}
        controls
        autoPlay
        loop
        className="max-w-full max-h-full rounded-xl shadow-2xl animate-fade-in"
        style={{ maxHeight: 'calc(100% - 60px)' }}
      />
      <button
        onClick={onDownload}
        className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white
                   px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors duration-200 shadow-lg"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Download Video
      </button>
    </div>
  )
}

function ErrorCanvas({ message, onRetry }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4">
      <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center">
        <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-red-400 font-medium">Video generation failed</p>
        <p className="text-gray-500 text-sm mt-1 max-w-xs">{message}</p>
      </div>
      <button onClick={onRetry} className="text-sm text-brand-400 hover:text-brand-300 underline underline-offset-2">
        Try again
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export default function VideoPage() {
  const navigate = useNavigate()
  const licenseKey = useAppStore((s) => s.licenseKey)
  const addJob = useAppStore((s) => s.addJob)
  const updateJobStore = useAppStore((s) => s.updateJob)

  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(8)
  const [quality, setQuality] = useState('fast')
  const [status, setStatus] = useState('idle')
  const [outputUrl, setOutputUrl] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [elapsed, setElapsed] = useState(0)

  const stopPollingRef = useRef(null)
  const timerRef = useRef(null)
  const textareaRef = useRef(null)

  // Cleanup polling and timer when component unmounts
  useEffect(() => {
    return () => {
      stopPollingRef.current?.()
      clearInterval(timerRef.current)
    }
  }, [])

  async function handleSubmit(e) {
    e?.preventDefault()
    const trimmed = prompt.trim()
    if (!trimmed || status === 'loading') return

    stopPollingRef.current?.()
    clearInterval(timerRef.current)

    setStatus('loading')
    setOutputUrl(null)
    setErrorMsg('')
    setElapsed(0)

    // Start elapsed timer
    timerRef.current = setInterval(() => {
      setElapsed(prev => prev + 1)
    }, 1000)

    try {
      const res = await generateVideo(licenseKey, { prompt: trimmed, duration, quality })
      const jobId = res.job_id
      addJob({ job_id: jobId, type: 'video', status: 'queued', prompt: trimmed })

      stopPollingRef.current = startPolling(licenseKey, jobId, (job) => {
        updateJobStore(jobId, job)
        if (job.status === 'completed' && job.output_url) {
          clearInterval(timerRef.current)
          setStatus('completed')
          setOutputUrl(job.output_url)
          stopPollingRef.current?.()
        } else if (job.status === 'failed') {
          clearInterval(timerRef.current)
          setStatus('failed')
          setErrorMsg(job.error || 'Generation failed. Please try again.')
          stopPollingRef.current?.()
        }
      })
    } catch (err) {
      clearInterval(timerRef.current)
      setStatus('failed')
      setErrorMsg(
        err?.response?.data?.message ||
        err?.message ||
        'Failed to start generation. Check that the backend is running.'
      )
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  async function handleDownload() {
    if (!outputUrl) return
    try {
      // Fetch as blob so Electron saves the file instead of opening a new page
      const res = await fetch(outputUrl)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `yourbrand-video-${Date.now()}.mp4`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
    } catch (err) {
      // Fallback: open in new tab
      window.open(outputUrl, '_blank')
    }
  }

  function handleRetry() {
    setStatus('idle')
    setErrorMsg('')
    setElapsed(0)
    textareaRef.current?.focus()
  }

  return (
    <div className="h-screen bg-dark-900 flex flex-col overflow-hidden">

      {/* Top bar */}
      <div className="bg-dark-800 border-b border-dark-500 px-4 py-3 flex items-center gap-4 flex-shrink-0">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors duration-200 group"
        >
          <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span className="text-sm font-medium">Dashboard</span>
        </button>

        <div className="h-4 w-px bg-dark-500" />

        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-purple-500" />
          <span className="text-white font-semibold text-sm">AI Video Generation</span>
        </div>

        {status === 'loading' && (
          <div className="ml-auto flex items-center gap-2 text-purple-400 text-sm">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Generating video... {elapsed}s
          </div>
        )}
        {status === 'completed' && (
          <div className="ml-auto flex items-center gap-2 text-green-400 text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Done in {elapsed}s
          </div>
        )}
      </div>

      {/* Canvas area */}
      <div className="flex-1 bg-dark-900 overflow-hidden">
        {status === 'idle'      && <EmptyCanvas />}
        {status === 'loading'   && <VideoProgress elapsed={elapsed} />}
        {status === 'completed' && <VideoResult url={outputUrl} onDownload={handleDownload} />}
        {status === 'failed'    && <ErrorCanvas message={errorMsg} onRetry={handleRetry} />}
      </div>

      {/* Bottom bar */}
      <div className="bg-dark-800 border-t border-dark-500 px-4 py-3 flex-shrink-0">
        <form onSubmit={handleSubmit} className="flex items-end gap-3 max-w-4xl mx-auto">

          {/* Prompt */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the video you want to create..."
              rows={1}
              disabled={status === 'loading'}
              className="w-full bg-dark-700 border border-dark-400 rounded-xl px-4 py-3
                         text-white placeholder-dark-300 resize-none
                         focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
                         transition-all duration-200 text-sm leading-relaxed
                         disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ minHeight: '44px', maxHeight: '120px' }}
            />
          </div>

          {/* Duration */}
          <div className="flex-shrink-0 flex items-center gap-1 bg-dark-700 border border-dark-400 rounded-xl p-1">
            {[4, 8].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                disabled={status === 'loading'}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
                  ${duration === d
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:text-white'
                  }`}
              >
                {d}s
              </button>
            ))}
          </div>

          {/* Quality */}
          <div className="flex-shrink-0 flex items-center gap-1 bg-dark-700 border border-dark-400 rounded-xl p-1">
            {[{ v: 'fast', l: 'Fast' }, { v: 'hd', l: 'HD' }].map(({ v, l }) => (
              <button
                key={v}
                type="button"
                onClick={() => setQuality(v)}
                disabled={status === 'loading'}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
                  ${quality === v
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:text-white'
                  }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Send */}
          <button
            type="submit"
            disabled={!prompt.trim() || status === 'loading'}
            className="w-10 h-10 flex-shrink-0 rounded-xl
                       bg-gradient-to-br from-purple-500 to-purple-700
                       hover:from-purple-400 hover:to-purple-600
                       disabled:opacity-40 disabled:cursor-not-allowed
                       text-white transition-all duration-200
                       flex items-center justify-center shadow-lg shadow-purple-500/25"
          >
            {status === 'loading' ? (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            )}
          </button>
        </form>

        <p className="text-center text-dark-300 text-xs mt-2">
          Video generation takes 1–2 minutes · <kbd className="bg-dark-600 px-1 rounded">Enter</kbd> to start
        </p>
      </div>
    </div>
  )
}
