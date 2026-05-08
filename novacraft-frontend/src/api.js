// src/api.js — NovaCraft API client
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

function getToken() { return localStorage.getItem('nc_token') }
function setToken(t) { localStorage.setItem('nc_token', t) }
function clearToken() { localStorage.removeItem('nc_token') }

async function req(method, path, body, isForm = false) {
  const token = getToken()
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  if (!isForm) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : (body ? JSON.stringify(body) : undefined),
  })

  if (res.status === 401) { clearToken(); window.location.href = '/login'; return }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `Error ${res.status}`)
  return data
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function register(name, email, password) {
  const data = await req('POST', '/auth/register', { name, email, password })
  setToken(data.token)
  return data.user
}

export async function login(email, password) {
  const data = await req('POST', '/auth/login', { email, password })
  setToken(data.token)
  return data.user
}

export function logout() { clearToken() }
export function isLoggedIn() { return !!getToken() }

export async function getMe() { return req('GET', '/auth/me') }

// ── Subscription ──────────────────────────────────────────────────────────────
export async function getSubscriptionStatus() { return req('GET', '/subscription/status') }

// ── Payment ───────────────────────────────────────────────────────────────────
export async function submitPayment(planName, transactionId, screenshotFile) {
  const form = new FormData()
  form.append('planName', planName)
  form.append('transactionId', transactionId)
  form.append('screenshot', screenshotFile)
  return req('POST', '/payment/submit', form, true)
}

export async function getPaymentHistory() { return req('GET', '/payment/history') }

export function screenshotUrl(fileName) {
  const token = getToken()
  return `${BASE}/payment/screenshot/${fileName}?token=${token}`
}

// ── Admin ─────────────────────────────────────────────────────────────────────
export async function adminGetPending()        { return req('GET',  '/admin/pending') }
export async function adminGetUsers()          { return req('GET',  '/admin/users') }
export async function adminApprove(id)         { return req('POST', `/admin/approve/${id}`) }
export async function adminReject(id, reason)  { return req('POST', `/admin/reject/${id}`, { reason }) }
export async function adminAdjustCredits(userId, delta) { return req('POST', `/admin/credits/${userId}`, { delta }) }
export async function adminRevoke(userId)      { return req('POST', `/admin/revoke/${userId}`) }
