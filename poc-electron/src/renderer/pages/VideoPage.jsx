// src/renderer/pages/VideoPage.jsx — Production Grade
// Fixes: panel-close-on-file-select, FileReader race, stale closure,
//        Start/End frame state persistence, 400 error, Flow-style UI
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { generateVideo, startPolling, friendlyError, resolveMediaUrl } from '../api'

// ─────────────────────────────────────────────────────────────────────────────
// Credit cost per duration
// ─────────────────────────────────────────────────────────────────────────────
const CREDIT_COST = { 4: 5, 6: 8, 8: 10 }

// ─────────────────────────────────────────────────────────────────────────────
// Utility: read a File as DataURL, returns a Promise<string>
// Avoids the async race of FileReader + useState by resolving into a single
// atomic call — caller can then batch state updates.
// ─────────────────────────────────────────────────────────────────────────────
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No file')); return }
    const reader = new FileReader()
    reader.onload  = (e) => resolve(e.target.result)
    reader.onerror = ()  => reject(new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas sub-components
// ─────────────────────────────────────────────────────────────────────────────

function VideoProgress({ elapsed, startPreview, endPreview }) {
  const percent = Math.min((elapsed / 360) * 100, 95)
  const hasFrames = startPreview || endPreview
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-5 p-8">

      {/* Frame thumbnails — persist during generation like Google Flow */}
      {hasFrames && (
        <div className="flex items-center gap-4 mb-2">
          {startPreview && (
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs text-purple-400 font-medium uppercase tracking-wide">Start</span>
              <div className="relative">
                <img src={startPreview} alt="Start"
                  className="w-28 h-18 object-cover rounded-lg border-2 border-purple-500/60 shadow-md"
                  style={{ height: '72px', width: '112px' }} />
                <div className="absolute inset-0 rounded-lg bg-purple-900/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-300 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
                  </svg>
                </div>
              </div>
            </div>
          )}
          {hasFrames && (
            <svg className="w-6 h-6 text-purple-400/50 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          )}
          {endPreview && (
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs text-purple-400 font-medium uppercase tracking-wide">End</span>
              <div className="relative">
                <img src={endPreview} alt="End"
                  className="w-28 h-18 object-cover rounded-lg border-2 border-purple-500/60 shadow-md"
                  style={{ height: '72px', width: '112px' }} />
                <div className="absolute inset-0 rounded-lg bg-purple-900/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-300 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
                  </svg>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <div className="w-16 h-16 rounded-full border-2 border-dark-500 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full border-2 border-purple-500/30 animate-ping absolute" />
          <svg className="w-7 h-7 text-purple-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72
                 M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9
                 A2.25 2.25 0 002.25 9.75v9A2.25 2.25 0 004.5 18.75z" />
          </svg>
        </div>
      </div>
      <div className="text-center">
        <p className="text-white font-semibold text-lg mb-1">Generating video...</p>
        <p className="text-gray-400 text-sm">This may take 1–2 minutes</p>
      </div>
      <div className="w-full max-w-sm">
        <div className="flex justify-between text-xs text-gray-500 mb-2">
          <span>Processing</span><span>{Math.round(percent)}%</span>
        </div>
        <div className="h-2 bg-dark-600 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-purple-500 to-brand-500 rounded-full transition-all duration-1000"
            style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-gray-500 text-right mt-1">{elapsed}s elapsed</p>
      </div>
    </div>
  )
}

function EmptyCanvas({ startPreview, endPreview }) {
  const has = startPreview || endPreview
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 select-none">
      {has ? (
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs text-purple-400 font-medium uppercase tracking-wide">Start</span>
            {startPreview
              ? <img src={startPreview} alt="Start" className="w-36 h-24 object-cover rounded-xl border-2 border-purple-500/60 shadow-lg" />
              : <div className="w-36 h-24 rounded-xl border-2 border-dashed border-dark-500 flex items-center justify-center">
                  <span className="text-dark-400 text-xs">Not set</span>
                </div>
            }
          </div>
          <div className="flex flex-col items-center gap-1">
            <svg className="w-7 h-7 text-purple-400/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs text-purple-400 font-medium uppercase tracking-wide">End</span>
            {endPreview
              ? <img src={endPreview} alt="End" className="w-36 h-24 object-cover rounded-xl border-2 border-purple-500/60 shadow-lg" />
              : <div className="w-36 h-24 rounded-xl border-2 border-dashed border-dark-500 flex items-center justify-center">
                  <span className="text-dark-400 text-xs">Not set</span>
                </div>
            }
          </div>
        </div>
      ) : (
        <>
          <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-dark-400 flex items-center justify-center">
            <svg className="w-8 h-8 text-dark-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72
                   M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9
                   A2.25 2.25 0 002.25 9.75v9A2.25 2.25 0 004.5 18.75z" />
            </svg>
          </div>
          <p className="text-dark-300 text-sm">Enter a prompt to generate a video</p>
          <p className="text-dark-400 text-xs">Use + to set start / end frames or add ingredients</p>
        </>
      )}
    </div>
  )
}

function VideoResult({ url, onDownload }) {
  const videoRef = useRef(null)
  const [error, setError]     = useState(false)
  const [playing, setPlaying] = useState(false)
  useEffect(() => { setError(false); setPlaying(false) }, [url])
  function handleLoaded() { videoRef.current?.play().then(() => setPlaying(true)).catch(() => {}) }
  function togglePlay() {
    if (!videoRef.current) return
    if (videoRef.current.paused) { videoRef.current.play(); setPlaying(true) }
    else { videoRef.current.pause(); setPlaying(false) }
  }
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-4">
      {error ? (
        <div className="flex-1 w-full max-w-3xl flex flex-col items-center justify-center bg-dark-800 rounded-xl border border-dark-500 gap-4">
          <p className="text-white font-semibold">Video generated ✓</p>
          <p className="text-gray-400 text-sm text-center max-w-xs">Preview unavailable. Click Download to save.</p>
        </div>
      ) : (
        <div className="relative flex-1 w-full max-w-3xl" style={{ maxHeight: 'calc(100vh - 220px)' }}>
          <video ref={videoRef} src={url} muted loop playsInline controls
            onLoadedData={handleLoaded} onError={() => setError(true)}
            className="w-full h-full object-contain rounded-xl shadow-2xl bg-dark-800"
            style={{ maxHeight: 'calc(100vh - 220px)' }} />
          {!playing && !error && (
            <button onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl hover:bg-black/40 transition-colors group">
              <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-white/30">
                <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              </div>
            </button>
          )}
        </div>
      )}
      <button onClick={onDownload}
        className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-lg">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
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
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-red-400 font-medium">Video generation failed</p>
        <p className="text-gray-500 text-sm mt-1 max-w-xs">{message}</p>
      </div>
      <button onClick={onRetry} className="text-sm text-brand-400 hover:text-brand-300 underline underline-offset-2">Try again</button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings Panel — matches Google Flow UI
// Panel close bug fix: receives onRequestUpload callbacks that set the
// isDialogOpen flag BEFORE triggering the file input, preventing the
// outside-click handler from closing the panel.
// ─────────────────────────────────────────────────────────────────────────────
function SettingsPanel({
  subTab, setSubTab,
  aspectRatio, setAspectRatio,
  duration, setDuration,
  startPreview, endPreview,
  onUploadStart, onUploadEnd, onClearStart, onClearEnd, onSwap,
  ingPreview, onUploadIng, onClearIng,
  disabled,
}) {
  const credits = CREDIT_COST[duration] || 10

  function FrameSlot({ label, preview, onUpload, onClear }) {
    return (
      <div className="flex flex-col gap-1 flex-1">
        <div className="flex items-center justify-between h-4">
          <span className="text-xs" style={{ color: '#888' }}>{label}</span>
          {preview && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClear() }}
              className="text-xs transition-colors" style={{ color: '#f87171' }}>✕</button>
          )}
        </div>
        <button
          type="button"
          onClick={onUpload}
          disabled={disabled}
          className="h-16 w-full rounded-xl overflow-hidden transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            border: `2px dashed ${preview ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.1)'}`,
            background: preview ? 'transparent' : 'rgba(255,255,255,0.03)',
          }}
        >
          {preview
            ? <img src={preview} alt={label} className="w-full h-full object-cover" />
            : <div className="flex flex-col items-center justify-center h-full gap-1" style={{ color: '#555' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-xs">{label}</span>
              </div>
          }
        </button>
      </div>
    )
  }

  return (
    <div
      className="absolute bottom-full mb-2 left-0 z-50 rounded-2xl overflow-hidden"
      style={{ width: 300, background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
    >
      {/* Image | Video tabs */}
      <div className="flex p-2 gap-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm cursor-default select-none"
          style={{ color: '#666' }}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409
                 a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18a.75.75 0 01.75.75v16.5a.75.75 0 01-.75.75H3
                 a.75.75 0 01-.75-.75V3.75A.75.75 0 013 3z" />
          </svg>
          <span>Image</span>
        </div>
        <div className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium select-none"
          style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72
                 M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9
                 A2.25 2.25 0 002.25 9.75v9A2.25 2.25 0 004.5 18.75z" />
          </svg>
          <span>Video</span>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* Frames | Ingredients sub-tabs */}
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.06)' }}>
          {[{ id: 'frames', label: 'Frames', icon: '⊡' }, { id: 'ingredients', label: 'Ingredients', icon: '⟲' }].map(t => (
            <button key={t.id} type="button" onClick={() => setSubTab(t.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
              style={{ background: subTab === t.id ? '#fff' : 'transparent', color: subTab === t.id ? '#111' : '#888' }}
            >
              <span>{t.icon}</span><span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Frames tab */}
        {subTab === 'frames' && (
          <div className="flex items-center gap-2">
            <FrameSlot label="Start" preview={startPreview} onUpload={onUploadStart} onClear={onClearStart} />
            {/* Swap arrow ⇄ — only active when both frames set */}
            <button type="button" onClick={(e) => { e.stopPropagation(); onSwap() }}
              disabled={disabled || (!startPreview && !endPreview)}
              title="Swap start and end frames"
              className="flex-shrink-0 mt-5 p-1.5 rounded-lg transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed"
              style={{ color: '#aaa', background: 'rgba(255,255,255,0.06)' }}
            >
              {/* Bidirectional arrow matching Google Flow's ⇄ icon */}
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
            <FrameSlot label="End" preview={endPreview} onUpload={onUploadEnd} onClear={onClearEnd} />
          </div>
        )}

        {/* Ingredients tab */}
        {subTab === 'ingredients' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: '#888' }}>Reference image to appear in video</span>
              {ingPreview && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onClearIng() }}
                  className="text-xs" style={{ color: '#f87171' }}>✕</button>
              )}
            </div>
            <button type="button" onClick={onUploadIng} disabled={disabled}
              className="h-20 w-full rounded-xl overflow-hidden transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ border: `2px dashed ${ingPreview ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.1)'}`, background: ingPreview ? 'transparent' : 'rgba(255,255,255,0.03)' }}
            >
              {ingPreview
                ? <img src={ingPreview} alt="Ingredient" className="w-full h-full object-cover" />
                : <div className="flex flex-col items-center justify-center h-full gap-1.5" style={{ color: '#555' }}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <span className="text-xs">Click to upload</span>
                  </div>
              }
            </button>
          </div>
        )}

        {/* Aspect ratio */}
        <div className="flex gap-1.5">
          {[{ v: '9:16', portrait: true }, { v: '16:9', portrait: false }].map(ar => (
            <button key={ar.v} type="button" onClick={() => setAspectRatio(ar.v)}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-xl text-xs font-medium transition-all duration-150"
              style={{
                background:  aspectRatio === ar.v ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                border:      `1px solid ${aspectRatio === ar.v ? 'rgba(255,255,255,0.2)' : 'transparent'}`,
                color:       aspectRatio === ar.v ? '#fff' : '#555',
              }}
            >
              {ar.portrait
                ? <svg viewBox="0 0 24 24" className="w-5 h-6" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="7" y="2" width="10" height="20" rx="2"/></svg>
                : <svg viewBox="0 0 24 24" className="w-6 h-5" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="7" width="20" height="10" rx="2"/></svg>
              }
              <span>{ar.v}</span>
            </button>
          ))}
        </div>

        {/* x1 multiplier only */}
        <div className="flex gap-1">
          <button type="button" className="px-4 py-1.5 rounded-lg text-sm font-medium text-white cursor-default"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            1x
          </button>
        </div>

        {/* Model (display only) */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl cursor-default"
          style={{ background: 'rgba(255,255,255,0.06)' }}>
          <span className="text-sm" style={{ color: '#ccc' }}>Veo 3.1 - Fast</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#555' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Duration: 4s | 6s | 8s */}
        <div className="flex gap-1">
          {[4, 6, 8].map(d => (
            <button key={d} type="button" onClick={() => setDuration(d)}
              className="flex-1 py-2 rounded-xl text-sm font-medium transition-all duration-150"
              style={{
                background: duration === d ? 'rgba(168,85,247,0.35)' : 'rgba(255,255,255,0.06)',
                color:      duration === d ? '#fff' : '#555',
              }}
            >{d}s</button>
          ))}
        </div>

        {/* Credits */}
        <p className="text-xs text-center" style={{ color: '#666' }}>
          Generating will use{' '}
          <span style={{ color: '#aaa', textDecoration: 'underline' }}>{credits} credits</span>
        </p>

        {/* Bottom pill */}
        <div className="flex justify-end">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs" style={{ background: 'rgba(255,255,255,0.1)', color: '#ccc' }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72
                   M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9
                   A2.25 2.25 0 002.25 9.75v9A2.25 2.25 0 004.5 18.75z" />
            </svg>
            <span>Video</span>
            {aspectRatio === '9:16'
              ? <svg viewBox="0 0 24 24" className="w-3 h-4" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="7" y="2" width="10" height="20" rx="2"/></svg>
              : <svg viewBox="0 0 24 24" className="w-4 h-3" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="7" width="20" height="10" rx="2"/></svg>
            }
            <span>{aspectRatio}</span>
            <span>1x</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function VideoPage() {
  const navigate       = useNavigate()
  const addJob         = useAppStore((s) => s.addJob)
  const updateJobStore = useAppStore((s) => s.updateJob)
  const prependHistory = useAppStore((s) => s.prependHistory)

  // ── Generation state ──────────────────────────────────────────
  const [prompt,    setPrompt]    = useState('')
  const [quality,   setQuality]   = useState('fast')
  const [status,    setStatus]    = useState('idle')
  const [outputUrl, setOutputUrl] = useState(null)
  const [errorMsg,  setErrorMsg]  = useState('')
  const [elapsed,   setElapsed]   = useState(0)

  // ── Panel / settings state ────────────────────────────────────
  const [showPanel,    setShowPanel]    = useState(false)
  const [subTab,       setSubTab]       = useState('frames')
  const [aspectRatio,  setAspectRatio]  = useState('16:9')
  const [duration,     setDuration]     = useState(8)

  // ── Frame / ingredient PREVIEW state (for rendering only) ─────
  // NOTE: previews are strings (DataURL), safe to store in useState.
  const [startPreview, setStartPreview] = useState(null)
  const [endPreview,   setEndPreview]   = useState(null)
  const [ingPreview,   setIngPreview]   = useState(null)

  // ── File objects in REFS (never stale, survive re-renders) ────
  // BUG FIX: storing File objects in useState causes stale closure issues
  // in handleSubmit because the submit handler captures the state value
  // at the time it was created. Using refs guarantees the latest value.
  const startFileRef = useRef(null)   // File | null
  const endFileRef   = useRef(null)   // File | null
  const ingFileRef   = useRef(null)   // File | null

  // ── Other refs ───────────────────────────────────────────────
  const stopPollingRef  = useRef(null)
  const timerRef        = useRef(null)
  const textareaRef     = useRef(null)
  const panelRef        = useRef(null)
  const startInputRef   = useRef(null)
  const endInputRef     = useRef(null)
  const ingInputRef     = useRef(null)
  const mountedRef      = useRef(true)

  // ── isDialogOpen: prevents outside-click from closing panel ──
  // ROOT CAUSE FIX: when user clicks "Upload" inside panel, we call
  // inputRef.current.click(). The native file dialog opens ASYNCHRONOUSLY.
  // Between the button click and the dialog opening, any other DOM event
  // could trigger the outside-click handler. We use this flag to guard.
  const isDialogOpenRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── Outside-click handler — respects dialog open flag ─────────
  useEffect(() => {
    function handleMouseDown(e) {
      // Do NOT close panel if a file dialog is open
      if (isDialogOpenRef.current) return
      if (!showPanel) return
      if (!panelRef.current) return
      if (panelRef.current.contains(e.target)) return
      // Also don't close if clicking the + button itself (it's a toggle)
      setShowPanel(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [showPanel])

  // ── File processing ────────────────────────────────────────────
  // Uses Promise-based readFileAsDataURL to avoid the FileReader + setState
  // async race condition. All state updates happen in one async tick.
  const processFile = useCallback(async (file, fileRef, setPreview) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { alert('Please select an image file (JPG, PNG, WebP)'); return }
    if (file.size > 10 * 1024 * 1024) { alert('Image must be under 10MB'); return }
    try {
      const dataUrl = await readFileAsDataURL(file)
      // Only update state if still mounted (avoids setState on unmounted component)
      if (!mountedRef.current) return
      fileRef.current = file      // store File in ref — never stale
      setPreview(dataUrl)         // store DataURL in state — for rendering
    } catch (err) {
      console.error('[VideoPage] File read error:', err)
    }
  }, [])

  // ── Upload trigger helpers ─────────────────────────────────────
  // PANEL CLOSE BUG FIX:
  // Steps: set isDialogOpenRef = true → trigger input.click()
  // The input.click() opens the OS file dialog. When the dialog closes
  // (user selects or cancels), the 'change' or 'focus' event fires and
  // we reset isDialogOpenRef. This prevents the outside-click handler
  // from closing the panel during the file selection window.
  function triggerUpload(inputRef) {
    isDialogOpenRef.current = true
    inputRef.current?.click()
    // Safety fallback: if dialog closes without firing 'change', reset after 5s
    setTimeout(() => { isDialogOpenRef.current = false }, 5000)
  }

  function handleStartFileChange(e) {
    isDialogOpenRef.current = false  // dialog is now closed
    const file = e.target.files?.[0]
    e.target.value = ''              // reset input so same file can be re-selected
    if (file) processFile(file, startFileRef, setStartPreview)
  }

  function handleEndFileChange(e) {
    isDialogOpenRef.current = false
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) processFile(file, endFileRef, setEndPreview)
  }

  function handleIngFileChange(e) {
    isDialogOpenRef.current = false
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) processFile(file, ingFileRef, setIngPreview)
  }

  // ── Swap frames ────────────────────────────────────────────────
  function handleSwap() {
    const tmpFile = startFileRef.current
    startFileRef.current = endFileRef.current
    endFileRef.current   = tmpFile

    const tmpPreview = startPreview
    setStartPreview(endPreview)
    setEndPreview(tmpPreview)
  }

  // ── Clear helpers ──────────────────────────────────────────────
  function clearAll() {
    startFileRef.current = null; setStartPreview(null)
    endFileRef.current   = null; setEndPreview(null)
    ingFileRef.current   = null; setIngPreview(null)
  }

  // ── Submit ─────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e?.preventDefault()
    const trimmed = prompt.trim()
    if (!trimmed || status === 'loading') return

    // Read File refs synchronously — guaranteed latest values (no stale closure)
    const startFile = startFileRef.current
    const endFile   = endFileRef.current
    const ingFile   = ingFileRef.current

    stopPollingRef.current?.()
    clearInterval(timerRef.current)
    setStatus('loading'); setOutputUrl(null); setErrorMsg(''); setElapsed(0)
    setShowPanel(false)

    timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000)

    try {
      const res = await generateVideo(trimmed, {
        duration,
        quality,
        aspect_ratio:    aspectRatio,
        start_frame:     startFile  || undefined,
        end_frame:       endFile    || undefined,
        reference_image: ingFile    || undefined,
      })

      const jobId = res.job_id
      addJob({ job_id: jobId, type: 'video', status: 'queued', prompt: trimmed })

      stopPollingRef.current = startPolling(jobId, {
        onProgress: (job) => {
          updateJobStore(jobId, job)
          if (job.status === 'processing' || job.status === 'queued') setElapsed(p => p + 3)
        },
        onComplete: (job) => {
          clearInterval(timerRef.current)
          setStatus('completed')
          setOutputUrl(resolveMediaUrl(job.output_url))
          prependHistory({ ...job, prompt: trimmed })
          stopPollingRef.current?.()
          clearAll()
        },
        onError: (msg) => {
          clearInterval(timerRef.current)
          setStatus('failed'); setErrorMsg(msg)
          stopPollingRef.current?.()
        },
      })
    } catch (err) {
      clearInterval(timerRef.current)
      setStatus('failed')
      setErrorMsg(friendlyError(err?.message || 'Failed to start generation'))
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  async function handleDownload() {
    if (!outputUrl) return
    try {
      const resp = await fetch(resolveMediaUrl(outputUrl))
      const blob = await resp.blob()
      const bu = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = bu; a.download = `video-${Date.now()}.mp4`; a.click()
      setTimeout(() => URL.revokeObjectURL(bu), 5000)
    } catch {
      const a = document.createElement('a')
      a.href = resolveMediaUrl(outputUrl); a.download = `video-${Date.now()}.mp4`; a.target = '_blank'; a.click()
    }
  }

  function handleRetry() {
    setStatus('idle'); setErrorMsg(''); setElapsed(0); clearAll()
    textareaRef.current?.focus()
  }

  const hasAttachments = !!(startFileRef.current || endFileRef.current || ingFileRef.current)
  const hasAnyPreview  = !!(startPreview || endPreview || ingPreview)

  return (
    <div className="h-screen bg-dark-900 flex flex-col overflow-hidden">

      {/* Hidden file inputs — must be in root, NOT inside panel to avoid z-index issues */}
      <input ref={startInputRef} type="file" accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }} onChange={handleStartFileChange} />
      <input ref={endInputRef}   type="file" accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }} onChange={handleEndFileChange} />
      <input ref={ingInputRef}   type="file" accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }} onChange={handleIngFileChange} />

      {/* Top bar */}
      <div className="bg-dark-800 border-b border-dark-500 px-4 py-3 flex items-center gap-4 flex-shrink-0">
        <button onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors duration-200 group">
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

        {/* Attachments badge */}
        {hasAnyPreview && status !== 'loading' && (
          <div className="hidden sm:flex items-center gap-1.5 ml-2">
            <div className="w-2 h-2 rounded-full bg-purple-400" />
            <span className="text-purple-400 text-xs font-medium">
              {[startPreview && 'Start', endPreview && 'End', ingPreview && 'Ingredient']
                .filter(Boolean).join(' + ')}
            </span>
          </div>
        )}

        {status === 'loading' && (
          <div className="ml-auto flex items-center gap-2 text-purple-400 text-sm">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Generating... {elapsed}s
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

      {/* Canvas */}
      <div className="flex-1 bg-dark-900 overflow-hidden">
        {status === 'idle'      && <EmptyCanvas startPreview={startPreview} endPreview={endPreview} />}
        {status === 'loading'   && <VideoProgress elapsed={elapsed} startPreview={startPreview} endPreview={endPreview} />}
        {status === 'completed' && <VideoResult url={outputUrl} onDownload={handleDownload} />}
        {status === 'failed'    && <ErrorCanvas message={errorMsg} onRetry={handleRetry} />}
      </div>

      {/* Bottom bar */}
      <div className="bg-dark-800 border-t border-dark-500 px-4 py-3 flex-shrink-0">
        <form onSubmit={handleSubmit} className="flex items-end gap-3 max-w-4xl mx-auto">

          {/* + button with Settings Panel popup */}
          <div className="relative flex-shrink-0" ref={panelRef}>
            <button
              type="button"
              onClick={() => setShowPanel(p => !p)}
              disabled={status === 'loading'}
              title="Frames, ingredients and settings"
              className="w-10 h-10 rounded-xl border transition-colors duration-200 flex items-center justify-center
                         disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background:  hasAnyPreview ? 'rgba(168,85,247,0.2)' : showPanel ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)',
                borderColor: hasAnyPreview ? 'rgba(168,85,247,0.7)' : showPanel ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                color:       hasAnyPreview ? '#c084fc' : '#888',
              }}
            >
              {/* Show thumbnail of first attached frame */}
              {(startPreview || endPreview || ingPreview)
                ? <img src={startPreview || endPreview || ingPreview} alt="" className="w-full h-full object-cover rounded-xl" />
                : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
              }
            </button>

            {showPanel && (
              <SettingsPanel
                subTab={subTab}          setSubTab={setSubTab}
                aspectRatio={aspectRatio} setAspectRatio={setAspectRatio}
                duration={duration}      setDuration={setDuration}
                startPreview={startPreview} endPreview={endPreview}
                onUploadStart={() => triggerUpload(startInputRef)}
                onUploadEnd={()   => triggerUpload(endInputRef)}
                onClearStart={() => { startFileRef.current = null; setStartPreview(null) }}
                onClearEnd={()   => { endFileRef.current   = null; setEndPreview(null) }}
                onSwap={handleSwap}
                ingPreview={ingPreview}
                onUploadIng={() => triggerUpload(ingInputRef)}
                onClearIng={() => { ingFileRef.current = null; setIngPreview(null) }}
                disabled={status === 'loading'}
              />
            )}
          </div>

          {/* Prompt textarea */}
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasAnyPreview ? 'Describe the motion or transformation...' : 'Describe the video you want to create...'}
              rows={1} disabled={status === 'loading'}
              className="w-full bg-dark-700 border border-dark-400 rounded-xl px-4 py-3
                         text-white placeholder-dark-300 resize-none
                         focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
                         transition-all duration-200 text-sm leading-relaxed
                         disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ minHeight: '44px', maxHeight: '120px' }}
            />
          </div>

          {/* Quality */}
          <div className="flex-shrink-0 flex gap-1 bg-dark-700 border border-dark-400 rounded-xl p-1">
            {[{ v: 'fast', l: 'Fast' }, { v: 'hd', l: 'HD' }].map(({ v, l }) => (
              <button key={v} type="button" onClick={() => setQuality(v)} disabled={status === 'loading'}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
                  ${quality === v ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >{l}</button>
            ))}
          </div>

          {/* Send */}
          <button type="submit" disabled={!prompt.trim() || status === 'loading'}
            className="w-10 h-10 flex-shrink-0 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700
                       hover:from-purple-400 hover:to-purple-600 disabled:opacity-40 disabled:cursor-not-allowed
                       text-white transition-all duration-200 flex items-center justify-center shadow-lg shadow-purple-500/25"
          >
            {status === 'loading'
              ? <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
            }
          </button>
        </form>

        <p className="text-center text-dark-300 text-xs mt-2">
          Video generation takes 1–2 minutes ·{' '}
          <kbd className="bg-dark-600 px-1 rounded">Enter</kbd> to start ·{' '}
          <span className="text-dark-400">+ for frames &amp; ingredients</span>
        </p>
      </div>
    </div>
  )
}
