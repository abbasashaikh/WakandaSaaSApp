// src/renderer/store/appStore.js — Global Zustand store
import { create } from 'zustand'
import { getMe } from '../api'

export const useAppStore = create((set, get) => ({

  // ── Auth (Phase 5) ─────────────────────────────────────────────────────────
  user:         null,
  isLoggedIn:   false,
  authChecked:  false,

  setUser:        (user) => set({ user, isLoggedIn: !!user, authChecked: true }),
  clearUser:      ()     => set({ user: null, isLoggedIn: false }),
  setAuthChecked: ()     => set({ authChecked: true }),

  checkAuth: async () => {
    try {
      const tokens = await window.electronAPI?.auth.getTokens()
      if (!tokens?.accessToken) {
        set({ authChecked: true, isLoggedIn: false })
        return false
      }
      const user = await getMe()
      set({ user, isLoggedIn: true, authChecked: true })
      return true
    } catch {
      await window.electronAPI?.auth.clearTokens()
      set({ authChecked: true, isLoggedIn: false })
      return false
    }
  },

  // ── Job management ─────────────────────────────────────────────────────────
  jobs: {},

  addJob: (job) => set(s => ({
    jobs: { ...s.jobs, [job.job_id]: job },
  })),

  updateJob: (jobId, updates) => set(s => ({
    jobs: { ...s.jobs, [jobId]: { ...(s.jobs[jobId] || {}), ...updates } },
  })),

  getJob: (jobId) => get().jobs[jobId] || null,

  // ── History (Phase 7) ──────────────────────────────────────────────────────
  history:        [],
  setHistory:     (history) => set({ history }),
  prependHistory: (job) => set(s => ({
    history: [job, ...s.history.filter(h => h.job_id !== job.job_id)].slice(0, 50),
  })),

  // ── Session health (Phase 8) ───────────────────────────────────────────────
  sessionWarning:    null,
  setSessionWarning: (msg) => set({ sessionWarning: msg }),
}))
