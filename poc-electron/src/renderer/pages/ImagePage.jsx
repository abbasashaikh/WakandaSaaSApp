// src/renderer/pages/ImagePage.jsx
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { generateImage, startPolling, friendlyError, resolveMediaUrl } from '../api'

// ── Aspect ratio config ───────────────────────────────────────
// Maps the ratio string to a Tailwind aspect-ratio utility class.
// '9:16' and '3:4' use arbitrary values since Tailwind has no
// built-in class for portrait ratios.
const ASPECT_OPTIONS = ['16:9', '1:1', '9:16', '4:3', '3:4']

// (aspect classes handled via inline style — see ASPECT_STYLE below)

// ── Aspect ratio → CSS value map ─────────────────────────────
const ASPECT_STYLE = {
  '16:9': 16 / 9,
  '1:1':  1,
  '9:16': 9 / 16,
  '4:3':  4 / 3,
  '3:4':  3 / 4,
}

// ── Canvas wrapper — all states share this shape ──────────────
// Uses explicit height as the driver so the div never collapses.
// Width is computed from height × ratio so the canvas fills the
// available vertical space perfectly.
function Canvas({ aspectRatio, children }) {
  const ratio = ASPECT_STYLE[aspectRatio] || (16 / 9)

  // The canvas area is: 100vh minus topbar(52px) + bottombar(80px) + padding(32px)
  // We use inline style so CSS calc works at runtime — Tailwind can't do this dynamically.
  const canvasStyle = {
    // Height: fill the available space (viewport - fixed chrome)
    height:    'calc(100vh - 180px)',
    // Width: driven by aspect ratio — never wider than viewport
    width:     `calc((100vh - 180px) * ${ratio})`,
    maxWidth:  'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 180px)',
    // If width hits maxWidth first (portrait ratio on wide screen),
    // recalculate height from the capped width
    aspectRatio: `${ratio}`,
  }

  return (
    <div className="w-full h-full flex items-center justify-center p-4 overflow-hidden">
      <div
        className="relative bg-dark-800 rounded-2xl overflow-hidden shadow-2xl transition-all duration-300"
        style={canvasStyle}
      >
        {children}
      </div>
    </div>
  )
}

// ── Sub-components — all receive aspectRatio prop ─────────────

function SkeletonCanvas({ aspectRatio }) {
  return (
    <Canvas aspectRatio={aspectRatio}>
      <div className="absolute inset-0 bg-dark-600 animate-pulse-slow">
        {/* Shimmer sweep */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-dark-500/50 to-transparent
                        animate-[shimmer_2s_infinite] -translate-x-full" />
      </div>
      {/* Centered label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <svg className="w-8 h-8 text-dark-400 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-dark-300 text-sm font-medium">Generating your image...</p>
      </div>
    </Canvas>
  )
}

function EmptyCanvas({ aspectRatio }) {
  return (
    <Canvas aspectRatio={aspectRatio}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 select-none
                      border-2 border-dashed border-dark-500 rounded-2xl">
        <div className="w-14 h-14 rounded-2xl border-2 border-dashed border-dark-400
                        flex items-center justify-center">
          <svg className="w-7 h-7 text-dark-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409
                 a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18a.75.75 0 01.75.75v16.5a.75.75 0 01-.75.75H3
                 a.75.75 0 01-.75-.75V3.75A.75.75 0 013 3z" />
          </svg>
        </div>
        <p className="text-dark-300 text-sm">Your image will appear here</p>
      </div>
    </Canvas>
  )
}

function ResultCanvas({ url, aspectRatio, onDownload }) {
  return (
    <Canvas aspectRatio={aspectRatio}>
      {/* Image fills the canvas exactly */}
      <img
        src={url}
        alt="Generated"
        className="absolute inset-0 w-full h-full object-cover rounded-2xl"
      />
      {/* Download button overlay — bottom centre */}
      <div className="absolute bottom-3 left-0 right-0 flex justify-center">
        <button
          onClick={onDownload}
          className="flex items-center gap-2 bg-black/60 hover:bg-black/80 backdrop-blur-sm
                     text-white px-4 py-2 rounded-xl text-sm font-semibold
                     transition-colors duration-200 shadow-lg border border-white/10"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download Image
        </button>
      </div>
    </Canvas>
  )
}

function ErrorCanvas({ message, aspectRatio, onRetry }) {
  return (
    <Canvas aspectRatio={aspectRatio}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center">
          <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-red-400 font-medium">Generation failed</p>
          <p className="text-gray-500 text-xs mt-1 max-w-[200px] leading-relaxed">{message}</p>
        </div>
        <button
          onClick={onRetry}
          className="text-sm text-brand-400 hover:text-brand-300 underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    </Canvas>
  )
}

// ── Main Page ─────────────────────────────────────────────────

export default function ImagePage() {
  const navigate        = useNavigate()
  const addJob          = useAppStore((s) => s.addJob)
  const updateJobStore  = useAppStore((s) => s.updateJob)
  const prependHistory  = useAppStore((s) => s.prependHistory)

  const [prompt,       setPrompt]       = useState('')
  const [aspectRatio,  setAspectRatio]  = useState('16:9')
  const [status,       setStatus]       = useState('idle')
  const [outputUrl,    setOutputUrl]    = useState(null)
  const [errorMsg,     setErrorMsg]     = useState('')

  const stopPollingRef = useRef(null)
  const textareaRef    = useRef(null)

  async function handleSubmit(e) {
    e?.preventDefault()
    const trimmed = prompt.trim()
    if (!trimmed || status === 'loading') return

    stopPollingRef.current?.()
    setStatus('loading')
    setOutputUrl(null)
    setErrorMsg('')

    try {
      const res   = await generateImage(trimmed, { aspect_ratio: aspectRatio })
      const jobId = res.job_id
      addJob({ job_id: jobId, type: 'image', status: 'queued', prompt: trimmed })

      stopPollingRef.current = startPolling(jobId, {
        onProgress: (job) => {
          updateJobStore(jobId, job)
        },
        onComplete: (job) => {
          setStatus('completed')
          setOutputUrl(resolveMediaUrl(job.output_url))
          prependHistory({ ...job, prompt: trimmed })
          stopPollingRef.current?.()
        },
        onError: (msg) => {
          setStatus('failed')
          setErrorMsg(msg)
          stopPollingRef.current?.()
        },
      })
    } catch (err) {
      setStatus('failed')
      setErrorMsg(friendlyError(err?.message || 'Failed to start generation'))
    }
  }

  function handleDownload() {
    if (!outputUrl) return
    const a = document.createElement('a')
    a.href     = resolveMediaUrl(outputUrl)
    a.download = `yourbrand-image-${Date.now()}.jpg`
    a.target   = '_blank'
    a.click()
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  function handleRetry() {
    setStatus('idle')
    setErrorMsg('')
    textareaRef.current?.focus()
  }

  return (
    <div className="h-screen bg-dark-900 flex flex-col overflow-hidden">

      {/* ── Top bar ──────────────────────────────────────────── */}
      <div className="bg-dark-800 border-b border-dark-500 px-4 py-3 flex items-center gap-4 flex-shrink-0">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors duration-200 group"
        >
          <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform"
               fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span className="text-sm font-medium">Dashboard</span>
        </button>

        <div className="h-4 w-px bg-dark-500" />

        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-brand-500" />
          <span className="text-white font-semibold text-sm">AI Image Generation</span>
        </div>

        {/* Aspect ratio preview badge in top bar */}
        <div className="ml-2 hidden sm:flex items-center gap-1.5">
          <span className="text-dark-300 text-xs">Canvas:</span>
          <span className="text-gray-400 text-xs font-mono bg-dark-700 px-2 py-0.5 rounded-lg">
            {aspectRatio}
          </span>
        </div>

        {status === 'loading' && (
          <div className="ml-auto flex items-center gap-2 text-brand-400 text-sm">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Generating...
          </div>
        )}
        {status === 'completed' && (
          <div className="ml-auto flex items-center gap-2 text-green-400 text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Done
          </div>
        )}
      </div>

      {/* ── Canvas area — changes shape with aspectRatio ──────── */}
      <div className="flex-1 bg-dark-900 overflow-hidden">
        {status === 'idle'      && <EmptyCanvas    aspectRatio={aspectRatio} />}
        {status === 'loading'   && <SkeletonCanvas  aspectRatio={aspectRatio} />}
        {status === 'completed' && <ResultCanvas    aspectRatio={aspectRatio} url={outputUrl}  onDownload={handleDownload} />}
        {status === 'failed'    && <ErrorCanvas     aspectRatio={aspectRatio} message={errorMsg} onRetry={handleRetry} />}
      </div>

      {/* ── Bottom bar ────────────────────────────────────────── */}
      <div className="bg-dark-800 border-t border-dark-500 px-4 py-3 flex-shrink-0">
        <form onSubmit={handleSubmit} className="flex items-end gap-3 max-w-4xl mx-auto">

          {/* Plus button */}
          <button
            type="button"
            className="w-10 h-10 flex-shrink-0 rounded-xl bg-dark-600 border border-dark-400
                       hover:bg-dark-500 text-gray-400 hover:text-white transition-colors duration-200
                       flex items-center justify-center"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>

          {/* Prompt textarea */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What do you want to create?"
              rows={1}
              disabled={status === 'loading'}
              className="w-full bg-dark-700 border border-dark-400 rounded-xl px-4 py-3
                         text-white placeholder-dark-300 resize-none
                         focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
                         transition-all duration-200 text-sm leading-relaxed
                         disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ minHeight: '44px', maxHeight: '120px' }}
            />
          </div>

          {/* Aspect ratio selector */}
          <div className="flex-shrink-0">
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              disabled={status === 'loading'}
              className="bg-dark-700 border border-dark-400 rounded-xl px-3 py-3
                         text-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500
                         cursor-pointer transition-colors duration-200
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ASPECT_OPTIONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Send button */}
          <button
            type="submit"
            disabled={!prompt.trim() || status === 'loading'}
            className="w-10 h-10 flex-shrink-0 rounded-xl
                       bg-gradient-to-br from-brand-500 to-brand-600
                       hover:from-brand-400 hover:to-brand-500
                       disabled:opacity-40 disabled:cursor-not-allowed
                       text-white transition-all duration-200
                       flex items-center justify-center shadow-lg shadow-brand-500/25"
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
          Press <kbd className="bg-dark-600 px-1 rounded">Enter</kbd> to generate ·{' '}
          <kbd className="bg-dark-600 px-1 rounded">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  )
}
