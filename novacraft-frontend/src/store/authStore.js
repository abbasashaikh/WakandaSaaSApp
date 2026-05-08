import { create } from 'zustand'
import { getMe, logout as apiLogout } from '../api'

export const useAuthStore = create((set) => ({
  user: null,
  loading: true,

  init: async () => {
    const token = localStorage.getItem('nc_token')
    if (!token) { set({ loading: false }); return }
    try {
      const data = await getMe()
      set({ user: data, loading: false })
    } catch {
      localStorage.removeItem('nc_token')
      set({ loading: false })
    }
  },

  setUser: (user) => set({ user }),
  logout: () => {
    apiLogout()
    set({ user: null })
  },
}))
