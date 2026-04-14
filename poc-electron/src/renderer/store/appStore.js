// src/renderer/store/appStore.js — Global state (Zustand)
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const STORAGE_KEY = 'yb-poc-store'

export const useAppStore = create(
  persist(
    (set, get) => ({
      // ─── Auth ─────────────────────────────────────────────
      licenseKey: null,
      user: null,
      subscription: null,
      isAuthenticated: false,

      setAuth: (licenseKey, user, subscription) =>
        set({ licenseKey, user, subscription, isAuthenticated: true }),

      clearAuth: () =>
        set({ licenseKey: null, user: null, subscription: null, isAuthenticated: false }),

      // ─── Job history (in-memory, not persisted) ────────────
      recentJobs: [],

      addJob: (job) =>
        set((state) => ({
          recentJobs: [job, ...state.recentJobs].slice(0, 20),
        })),

      updateJob: (jobId, updates) =>
        set((state) => ({
          recentJobs: state.recentJobs.map((j) =>
            j.job_id === jobId ? { ...j, ...updates } : j
          ),
        })),
    }),
    {
      name: STORAGE_KEY,
      // Only persist auth fields
      partialize: (state) => ({
        licenseKey: state.licenseKey,
        user: state.user,
        subscription: state.subscription,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
