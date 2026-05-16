// src/api.js — Android API client
// Mirrors poc-electron/src/renderer/api.js exactly.
// Only differences from Electron:
//   1. PLATFORM = 'android'
//   2. Token storage uses AsyncStorage (not Electron IPC)
//   3. BASE_URL from AsyncStorage (set at app startup from user input)
//   4. generateVideo supports React Native FormData { uri, type, name } for frames

import AsyncStorage from '@react-native-async-storage/async-storage'

// ── Platform identifier ───────────────────────────────────────────────────────
const PLATFORM = 'android'

// ── URL resolution ────────────────────────────────────────────────────────────
let _BASE       = 'http://localhost:3001/api'
let _MEDIA_BASE = 'http://localhost:3001'

export async function initApiUrl() {
  const stored = await AsyncStorage.getItem('api_base_url').catch(() => null)
  if (stored) setApiUrl(stored)
}

export function setApiUrl(rawUrl) {
  const clean   = rawUrl.trim().replace(/\/+$/, '').replace(/\/api$/, '')
  _BASE         = `${clean}/api`
  _MEDIA_BASE   = clean
}

export function getApiUrl() { return _MEDIA_BASE }

// ── Bypass + platform headers ─────────────────────────────────────────────────
function getBypassHeaders() {
  return {
    'ngrok-skip-browser-warning': 'true',
    'x-github-token':             'bypass',
    'x-platform':                 PLATFORM,
  }
}

// ── Media URL resolver ────────────────────────────────────────────────────────
export function resolveMediaUrl(url) {
  if (!url) return url
  if (url.startsWith('/media/')) return `${_MEDIA_BASE}${url}`
  return url
}

// ── Error mapping ─────────────────────────────────────────────────────────────
const ERROR_MAP = [
  { match: /recaptcha|unusual.activity/i,
    msg: 'Google is rate-limiting. Wait 30 seconds and try again.' },
  { match: /session.cookie.expired|captureSession/i,
    msg: 'Server session expired. Contact your admin.' },
  { match: /timeout.*exceeded|Timeout/i,
    msg: 'Request timed out. Check your internet connection.' },
  { match: /403/,
    msg: 'Access denied by AI service. Try again in a few seconds.' },
  { match: /rate.limit|429|too.many/i,
    msg: 'Too many requests. Please wait a moment.' },
  { match: /pool.acquire.timeout/i,
    msg: 'Server is busy. Please wait for current job to finish.' },
  { match: /file.too.large|FILE_TOO_LARGE/i,
    msg: 'Image file is too large. Please use an image under 10MB.' },
  { match: /ECONNREFUSED|ENOTFOUND|network/i,
    msg: 'Cannot reach server. Check your server URL in settings.' },
  { match: /jwt.expired|token.*expired|unauthorized/i,
    msg: 'Session expired. Please log in again.' },
]

export function friendlyError(raw) {
  if (!raw) return 'Something went wrong. Please try again.'
  for (const { match, msg } of ERROR_MAP) {
    if (match.test(raw)) return msg
  }
  return raw.replace(/Call log:[\s\S]*/i, '').trim().slice(0, 140)
}

// ── Token storage ─────────────────────────────────────────────────────────────
export async function saveTokens(tokens) {
  await AsyncStorage.setItem('auth_tokens', JSON.stringify(tokens))
}

export async function getTokens() {
  const raw = await AsyncStorage.getItem('auth_tokens').catch(() => null)
  return raw ? JSON.parse(raw) : null
}

export async function clearTokens() {
  await AsyncStorage.removeItem('auth_tokens')
}

// ── JWT token management ──────────────────────────────────────────────────────
let _refreshPromise = null

async function getAccessToken() {
  const tokens = await getTokens()
  if (!tokens?.accessToken) return null
  if (Date.now() < (tokens.expiresAt || 0) - 60_000) return tokens.accessToken
  if (!_refreshPromise) {
    _refreshPromise = _doRefresh(tokens.refreshToken).finally(() => {
      _refreshPromise = null
    })
  }
  return _refreshPromise
}

async function _doRefresh(refreshToken) {
  if (!refreshToken) throw new Error('jwt_expired')
  const res = await fetch(`${_BASE}/refresh`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...getBypassHeaders() },
    body:    JSON.stringify({ refresh_token: refreshToken }),
  })
  if (!res.ok) {
    await clearTokens()
    throw new Error('jwt_expired')
  }
  const data = await res.json()
  const t = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt:    Date.now() + (data.expires_in || 3600) * 1000,
  }
  await saveTokens(t)
  return t.accessToken
}

// ── apiFetch — JSON requests ───────────────────────────────────────────────────
async function apiFetch(endpoint, options = {}) {
  const token = await getAccessToken()
  const headers = {
    'Content-Type': 'application/json',
    ...getBypassHeaders(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }
  const res = await fetch(`${_BASE}${endpoint}`, { ...options, headers })
  if (res.status === 401) {
    await clearTokens()
    throw new Error('jwt_expired')
  }
  return res
}

// ── apiFetchFormData — multipart/form-data for file uploads ───────────────────
// React Native FormData is different from web:
//   Web:    formData.append('field', fileObject)
//   RN:     formData.append('field', { uri, type, name })
// DO NOT set Content-Type — React Native sets it with boundary automatically.
async function apiFetchFormData(endpoint, formData) {
  const token = await getAccessToken()
  const headers = {
    // Content-Type deliberately omitted — RN sets multipart/form-data + boundary
    ...getBypassHeaders(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const res = await fetch(`${_BASE}${endpoint}`, {
    method:  'POST',
    headers,
    body:    formData,
  })
  if (res.status === 401) {
    await clearTokens()
    throw new Error('jwt_expired')
  }
  return res
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function login(licenseKey) {
  const res = await fetch(`${_BASE}/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...getBypassHeaders() },
    body:    JSON.stringify({ license_key: licenseKey }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Login failed (${res.status})`)
  }
  const data = await res.json()
  await saveTokens({
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
      await fetch(`${_BASE}/logout`, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...getBypassHeaders(),
        },
      })
    }
  } catch {}
  await clearTokens()
}

export async function getMe() {
  const res = await apiFetch('/me')
  if (!res.ok) throw new Error('Not authenticated')
  return res.json()
}

// ── generateImage ─────────────────────────────────────────────────────────────
export async function generateImage(prompt, options = {}) {
  const res = await apiFetch('/generate/image', {
    method: 'POST',
    body:   JSON.stringify({ prompt, ...options }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Failed to queue image (${res.status})`)
  }
  return res.json()
}

// ── generateVideo — supports optional start_frame / end_frame / reference_image
// Frame assets are { uri, type, name } objects from react-native-image-picker.
// When frames are present, uses multipart FormData instead of JSON.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateVideo(prompt, options = {}) {
  const { start_frame, end_frame, reference_image, duration, quality, aspect_ratio } = options

  // Detect if any frame asset is attached
  // React Native image picker returns { uri, type, fileName } — we check for uri
  const hasFrames = (start_frame?.uri) || (end_frame?.uri) || (reference_image?.uri)

  // Normalise duration: accept '8s', '8', 8 — always send as 'Xs' string
  const durStr = String(duration || '8').replace(/s$/i, '') + 's' // '8' → '8s', '8s' → '8s', 8 → '8s'

  if (hasFrames) {
    // Build FormData — React Native style
    const fd = new FormData()
    fd.append('prompt',       prompt)
    fd.append('duration',     durStr)
    fd.append('quality',      quality || 'fast')
    if (aspect_ratio) fd.append('aspect_ratio', aspect_ratio)

    if (start_frame?.uri) {
      fd.append('start_frame', {
        uri:  start_frame.uri,
        type: start_frame.type || 'image/jpeg',
        name: start_frame.fileName || start_frame.name || 'start_frame.jpg',
      })
    }
    if (end_frame?.uri) {
      fd.append('end_frame', {
        uri:  end_frame.uri,
        type: end_frame.type || 'image/jpeg',
        name: end_frame.fileName || end_frame.name || 'end_frame.jpg',
      })
    }
    if (reference_image?.uri) {
      fd.append('reference_image', {
        uri:  reference_image.uri,
        type: reference_image.type || 'image/jpeg',
        name: reference_image.fileName || reference_image.name || 'reference.jpg',
      })
    }

    const res = await apiFetchFormData('/generate/video', fd)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || `Failed to queue video (${res.status})`)
    }
    return res.json()
  }

  // No frames — JSON request
  const res = await apiFetch('/generate/video', {
    method: 'POST',
    body:   JSON.stringify({ prompt, duration: durStr, quality: quality || 'fast', aspect_ratio }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Failed to queue video (${res.status})`)
  }
  return res.json()
}

// ── Polling ───────────────────────────────────────────────────────────────────
export function startPolling(jobId, { onProgress, onComplete, onError, intervalMs = 3000 } = {}) {
  let timer   = null
  let stopped = false

  async function poll() {
    try {
      const res = await apiFetch(`/jobs/${jobId}`)
      if (res.status === 404) { onError?.('Job not found'); return }
      const job = await res.json()
      if (job.output_url) job.output_url = resolveMediaUrl(job.output_url)
      onProgress?.(job)
      if (job.status === 'completed') { onComplete?.(job); return }
      if (job.status === 'failed') { onError?.(friendlyError(job.error)); return }
      if (!stopped) timer = setTimeout(poll, intervalMs)
    } catch (err) {
      onError?.(err.message === 'jwt_expired'
        ? 'Session expired — please log in again'
        : friendlyError(err.message))
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
  if (data.jobs) {
    data.jobs = data.jobs.map(j => ({ ...j, output_url: resolveMediaUrl(j.output_url) }))
  }
  return data
}

// ── Health ────────────────────────────────────────────────────────────────────
export async function checkHealth() {
  const res = await fetch(`${_MEDIA_BASE}/health`, {
    headers: getBypassHeaders(),
  }).catch(() => null)
  if (!res?.ok) return null
  return res.json()
}
