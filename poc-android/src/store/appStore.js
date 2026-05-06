// src/store/appStore.js — Android global store
// Mirrors poc-electron/src/renderer/store/appStore.js exactly.
// Same shape — platform-agnostic business logic.
import { create } from 'zustand'
import { getMe, initApiUrl } from '../api'

export const useAppStore = create((set, get) => ({

  // ── App init ──────────────────────────────────────────────────────────────
  isReady:      false,      // URL configured and auth checked
  setReady:     () => set({ isReady: true }),

  // ── Auth ──────────────────────────────────────────────────────────────────
  user:         null,
  isLoggedIn:   false,
  authChecked:  false,

  setUser:        (user) => set({ user, isLoggedIn: !!user, authChecked: true }),
  clearUser:      ()     => set({ user: null, isLoggedIn: false }),
  setAuthChecked: ()     => set({ authChecked: true }),

  checkAuth: async () => {
    try {
      await initApiUrl()        // load saved server URL from AsyncStorage
      const user = await getMe()
      set({ user, isLoggedIn: true, authChecked: true, isReady: true })
      return true
    } catch {
      set({ authChecked: true, isLoggedIn: false, isReady: true })
      return false
    }
  },

  // ── Job management ────────────────────────────────────────────────────────
  jobs: {},
  addJob:    (job) => set(s => ({ jobs: { ...s.jobs, [job.job_id]: job } })),
  updateJob: (id, u) => set(s => ({
    jobs: { ...s.jobs, [id]: { ...(s.jobs[id] || {}), ...u } },
  })),

  // ── History ───────────────────────────────────────────────────────────────
  history:        [],
  setHistory:     (h) => set({ history: h }),
  prependHistory: (job) => set(s => ({
    history: [job, ...s.history.filter(x => x.job_id !== job.job_id)].slice(0, 50),
  })),

  // ── Server URL ────────────────────────────────────────────────────────────
  serverUrl:    '',
  setServerUrl: (url) => set({ serverUrl: url }),
}))
