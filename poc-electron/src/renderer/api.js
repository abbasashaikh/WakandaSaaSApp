// src/renderer/api.js — All backend API calls
import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const client = axios.create({
  baseURL: BASE,
  timeout: 15000,
})

// ─── Auth ─────────────────────────────────────────────────────

export async function validateKey(licenseKey) {
  const res = await client.post('/api/validate-key', { license_key: licenseKey })
  return res.data
}

export async function register(name, email) {
  const res = await client.post('/api/register', { name, email })
  return res.data
}

// ─── Generation ───────────────────────────────────────────────

export async function generateImage(licenseKey, { prompt, model = 'default', aspect_ratio = '16:9' }) {
  const res = await client.post(
    '/api/generate/image',
    { prompt, model, aspect_ratio },
    { headers: { 'X-License-Key': licenseKey } }
  )
  return res.data
}

export async function generateVideo(licenseKey, { prompt, duration = 8, quality = 'fast' }) {
  const res = await client.post(
    '/api/generate/video',
    { prompt, duration, quality },
    { headers: { 'X-License-Key': licenseKey } }
  )
  return res.data
}

// ─── Job polling ──────────────────────────────────────────────

export async function pollJob(licenseKey, jobId) {
  const res = await client.get(`/api/jobs/${jobId}`, {
    headers: { 'X-License-Key': licenseKey },
  })
  return res.data
}

export async function getJobHistory(licenseKey) {
  const res = await client.get('/api/jobs', {
    headers: { 'X-License-Key': licenseKey },
  })
  return res.data
}

// ─── Health ───────────────────────────────────────────────────

export async function checkHealth() {
  const res = await client.get('/health')
  return res.data
}

// ─── Poll helper — keeps polling until job is done ────────────
export function startPolling(licenseKey, jobId, onUpdate, intervalMs = 3000) {
  let active = true

  async function poll() {
    if (!active) return
    try {
      const job = await pollJob(licenseKey, jobId)
      onUpdate(job)
      if (job.is_done) return
    } catch (err) {
      console.error('[Poll] Error:', err.message)
    }
    if (active) setTimeout(poll, intervalMs)
  }

  poll()
  return () => { active = false }
}
