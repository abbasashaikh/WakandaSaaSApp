// src/renderer/api.js — JWT API client (Phase 5+6)
// API base URL — always the local backend
// Do NOT use import.meta.env here: VITE_API_URL is often set to the root URL
// without the /api suffix which causes 404s on all auth routes.
const BASE = (import.meta.env?.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api$/, '') + '/api'
  : 'http://localhost:3001/api')


const MEDIA_BASE = 'http://localhost:3001'
// ── URL resolution ────────────────────────────────────────────────────────────
// Derive both BASE (API calls) and MEDIA_BASE (media files) from the same env var.
// This ensures testers pointing to Codespace URL get media from the same host.

function _buildBaseUrl() {
  const raw = import.meta.env?.VITE_API_URL || ''

  if (!raw) {
    // No env var set — fall back to localhost (local dev)
    return { BASE: 'http://localhost:3001/api', MEDIA_BASE: 'http://localhost:3001' }
  }

  // Strip any trailing slash and any trailing /api
  const clean = raw.replace(/\/+$/, '').replace(/\/api$/, '')

  return {
    BASE:       `${clean}/api`,
    MEDIA_BASE: clean,
  }
}

//const { BASE, MEDIA_BASE } = _buildBaseUrl()

// ── Platform identifier ──────────────────────────────────────────────────────
// Sent with every request so the backend can track which app is calling.
// Windows Electron app always sends 'windows'.
// Android app sends 'android' (defined in android/src/api.js).
// This header is logged per-request and stored on each job record.
const PLATFORM = 'windows'

// ── Bypass headers ────────────────────────────────────────────────────────────
// Required for both ngrok tunnels and GitHub Codespace URLs.
// Without these, both services show an interstitial HTML page instead of JSON.
const BYPASS_HEADERS = {
  'ngrok-skip-browser-warning': 'true',
  'x-github-token':             'bypass',
  'x-platform':                 PLATFORM,
}


// ── Phase 6: User-friendly error mapping ─────────────────────────────────────
const ERROR_MAP = [
  { match: /recaptcha|unusual.activity/i,
    msg: 'Google is rate-limiting this device. Wait 30 seconds and try again.' },
  { match: /session.cookie.expired|captureSession/i,
    msg: 'The browser session has expired. Ask your admin to refresh the session.' },
  { match: /timeout.*exceeded|Timeout/i,
    msg: 'The request timed out. Check your internet connection and try again.' },
  { match: /403/,
    msg: 'Access was denied by the AI service. Try again in a few seconds.' },
  { match: /rate.limit|429|too.many/i,
    msg: 'Too many requests. Please wait a moment before trying again.' },
  { match: /pool.acquire.timeout/i,
    msg: 'All generation slots are busy. Please wait for the current job to finish.' },
  { match: /prompt.input.not.found/i,
    msg: 'The AI service page failed to load. This will retry automatically.' },
  { match: /ECONNREFUSED|ENOTFOUND|network/i,
    msg: 'Cannot reach the backend server. Make sure it is running.' },
  { match: /jwt.expired|token.*expired|unauthorized/i,
    msg: 'Your session expired. Please log in again.' },
]

export function friendlyError(raw) {
  if (!raw) return 'Something went wrong. Please try again.'
  for (const { match, msg } of ERROR_MAP) {
    if (match.test(raw)) return msg
  }
  const cleaned = raw
    .replace(/Call log:[\s\S]*/i, '')
    .replace(/page\.\w+:\s*/g, '')
    .replace(/\u001b\[\d+m/g, '')
    .trim()
  return cleaned.length > 140 ? cleaned.slice(0, 140) + '…' : cleaned
}

// ── Resolve media URL ─────────────────────────────────────────────────────────
// Backend now returns /media/xxx — prepend localhost base
export function resolveMediaUrl(url) {
  if (!url) return url
  if (url.startsWith('/media/')) return `${MEDIA_BASE}${url}`
  return url
}

// ── JWT token management ──────────────────────────────────────────────────────
let _refreshPromise = null

async function getAccessToken() {
  const tokens = await window.electronAPI?.auth.getTokens()
  if (!tokens?.accessToken) return null
  if (Date.now() < (tokens.expiresAt || 0) - 60_000) return tokens.accessToken
  if (!_refreshPromise) {
    _refreshPromise = _doRefresh(tokens.refreshToken).finally(() => { _refreshPromise = null })
  }
  return _refreshPromise
}

async function _doRefresh(refreshToken) {
  if (!refreshToken) throw new Error('jwt_expired')
  const res = await fetch(`${BASE}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  if (!res.ok) {
    await window.electronAPI?.auth.clearTokens()
    throw new Error('jwt_expired')
  }
  const data = await res.json()
  const t = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt:    Date.now() + (data.expires_in || 3600) * 1000,
  }
  await window.electronAPI?.auth.saveTokens(t)
  return t.accessToken
}

async function apiFetch(endpoint, options = {}) {
  const token = await getAccessToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }
  const res = await fetch(`${BASE}${endpoint}`, { ...options, headers })
  if (res.status === 401) {
    await window.electronAPI?.auth.clearTokens()
    throw new Error('jwt_expired')
  }
  return res
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function login(licenseKey) {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_key: licenseKey }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Login failed (${res.status})`)
  }
  const data = await res.json()
  await window.electronAPI?.auth.saveTokens({
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    Date.now() + (data.expires_in || 3600) * 1000,
  })
  return data.user || {}
}

export async function logout() {
  try {
    const token = await getAccessToken()
    if (token) {
      await fetch(`${BASE}/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
    }
  } catch {}
  await window.electronAPI?.auth.clearTokens()
}

export async function getMe() {
  const res = await apiFetch('/me')
  if (!res.ok) throw new Error('Not authenticated')
  return res.json()
}

// ── Generation — backwards-compatible signatures ───────────────────────────
// Old signature: generateImage(licenseKey, { prompt, aspect_ratio, ... })
// New signature: generateImage(prompt, options)
// We detect which is being used by checking if first arg looks like a key.

function _normalizeArgs(first, second) {
  if (typeof first === 'string' && second && typeof second === 'object') {
    // OLD convention: generateImage(licenseKey, { prompt, aspect_ratio })
    //   → second object already has a 'prompt' field → return second as-is
    // NEW convention: generateImage(promptString, { aspect_ratio })
    //   → second object has NO 'prompt' → first IS the prompt
    if (second.prompt) return second
    return { prompt: first, ...second }
  }
  if (typeof first === 'string') return { prompt: first, ...(second || {}) }
  return first || {}
}

export async function generateImage(promptOrKey, optionsOrUndefined) {
  const opts = _normalizeArgs(promptOrKey, optionsOrUndefined)
  const res = await apiFetch('/generate/image', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Failed to queue image (${res.status})`)
  }
  return res.json()
}

// ── apiFetchFormData — multipart (for file uploads) ───────────────────────────
// NEVER set Content-Type manually — browser sets it automatically with boundary
async function apiFetchFormData(endpoint, formData) {
  const token = await getAccessToken()
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...BYPASS_HEADERS,
  }
  const res = await fetch(`${BASE}${endpoint}`, {
    method:  'POST',
    headers,
    body:    formData,
  })
  if (res.status === 401) {
    await window.electronAPI?.auth.clearTokens()
    throw new Error('jwt_expired')
  }
  return res
}

export async function generateVideo(promptOrKey, optionsOrUndefined) {
  const opts = _normalizeArgs(promptOrKey, optionsOrUndefined)
  const { start_frame, end_frame, reference_image, ...restOpts } = opts

  // ── Has file attachments → use FormData ───────────────────────────────────
  const hasFiles = (start_frame   instanceof File) ||
                   (end_frame     instanceof File) ||
                   (reference_image instanceof File)

  if (hasFiles) {
    const fd = new FormData()
    // ALWAYS use string for prompt — never serialize objects
    fd.append('prompt',   String(restOpts.prompt || ''))
    // Duration MUST be in "Xs" format — backend validates ['4s','6s','8s']
    const dur = restOpts.duration
    fd.append('duration', typeof dur === 'number' ? `${dur}s` : String(dur || '8s'))
    fd.append('quality',  String(restOpts.quality || 'fast'))
    if (restOpts.aspect_ratio) fd.append('aspect_ratio', restOpts.aspect_ratio)

    if (start_frame   instanceof File) fd.append('start_frame',   start_frame,   start_frame.name)
    if (end_frame     instanceof File) fd.append('end_frame',     end_frame,     end_frame.name)
    if (reference_image instanceof File) fd.append('reference_image', reference_image, reference_image.name)

    const res = await apiFetchFormData('/generate/video', fd)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || `Failed to queue video (${res.status})`)
    }
    return res.json()
  }

  // ── No files → JSON (always explicit duration format) ─────────────────────
  const dur = restOpts.duration
  const cleanOpts = {
    ...restOpts,
    duration: typeof dur === 'number' ? `${dur}s` : String(dur || '8s'),
  }
  const res = await apiFetch('/generate/video', {
    method: 'POST',
    body:   JSON.stringify(cleanOpts),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Failed to queue video (${res.status})`)
  }
  return res.json()
}

// ── Polling ───────────────────────────────────────────────────────────────────
// Old signature: startPolling(licenseKey, jobId, callback)
// New signature: startPolling(jobId, { onProgress, onComplete, onError })

export function startPolling(licenseKeyOrJobId, jobIdOrOptions, legacyCallback) {
  // Detect old vs new calling convention
  let jobId, onProgress, onError, onComplete, intervalMs = 3000

  if (typeof jobIdOrOptions === 'string') {
    // Old: startPolling(licenseKey, jobId, callback)
    jobId      = jobIdOrOptions
    onProgress = legacyCallback
    onComplete = null
    onError    = null
  } else {
    // New: startPolling(jobId, { onProgress, onComplete, onError })
    jobId      = licenseKeyOrJobId
    onProgress = jobIdOrOptions?.onProgress
    onComplete = jobIdOrOptions?.onComplete
    onError    = jobIdOrOptions?.onError
    intervalMs = jobIdOrOptions?.intervalMs || 3000
  }

  let timer   = null
  let stopped = false

  async function poll() {
    try {
      const res = await apiFetch(`/jobs/${jobId}`)
      if (res.status === 404) { onError?.('Job not found'); return }
      const job = await res.json()

      // Resolve local media URL
      if (job.output_url) job.output_url = resolveMediaUrl(job.output_url)

      onProgress?.(job)

      if (job.status === 'completed') { onComplete?.(job); return }
      if (job.status === 'failed') {
        const msg = friendlyError(job.error)
        onError?.(msg)
        // Also call legacy callback with failed job
        return
      }
      if (!stopped) timer = setTimeout(poll, intervalMs)
    } catch (err) {
      const msg = err.message === 'jwt_expired'
        ? 'Session expired — please log in again'
        : friendlyError(err.message)
      onError?.(msg)
    }
  }

  poll()
  return () => { stopped = true; if (timer) clearTimeout(timer) }
}

// ── History ───────────────────────────────────────────────────────────────────
export async function getJobHistory(limit = 20) {
  const res = await apiFetch(`/jobs?limit=${limit}`)
  if (!res.ok) throw new Error('Failed to load history')
  const data = await res.json()
  // Resolve URLs in history
  if (data.jobs) {
    data.jobs = data.jobs.map(j => ({
      ...j,
      output_url: resolveMediaUrl(j.output_url),
    }))
  }
  return data
}

// ── Health ────────────────────────────────────────────────────────────────────
export async function checkHealth() {
  const res = await fetch('http://localhost:3001/health').catch(() => null)
  if (!res?.ok) return null
  return res.json()
}
