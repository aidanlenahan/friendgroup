import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { setToken } from '../lib/api'

interface User {
  id: string
  email: string
  name: string
  username?: string | null
  avatarUrl?: string | null
  theme?: string | null
  isAdmin?: boolean
}

interface AuthState {
  user: User | null
  token: string | null
  login: (token: string, user: User) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: (token, user) => {
        setToken(token)
        set({ token, user })
      },
      logout: () => {
        setToken(null)
        set({ token: null, user: null })
      },
    }),
    {
      name: 'fg-auth',
      partialize: (state) => ({ user: state.user }),
    },
  ),
)
