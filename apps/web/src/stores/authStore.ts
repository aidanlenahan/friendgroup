import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { apiFetch } from '../lib/api'

interface User {
  id: string
  email: string
  name: string
  username?: string | null
  bio?: string | null
  avatarUrl?: string | null
  theme?: string | null
  showEmail?: boolean
  onboardingDone?: boolean
  birthdate?: string | null
  birthdateSet?: boolean
  isAdmin?: boolean
  isDemo?: boolean
}

interface AuthState {
  user: User | null
  hydrated: boolean
  login: (user: User) => void
  logout: () => void
  markHydrated: () => void
  setUser: (user: User) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      hydrated: false,
      login: (user) => {
        set({ user })
      },
      logout: () => {
        // Fire-and-forget: clear the HttpOnly cookie server-side.
        apiFetch('/auth/logout', { method: 'POST' }).catch(() => {/* ignore */})
        set({ user: null })
      },
      markHydrated: () => {
        set({ hydrated: true })
      },
      setUser: (user) => {
        set({ user })
      },
    }),
    {
      name: 'fg-auth',
      storage: createJSONStorage(() => localStorage),
      // Only persist the user object — never the token (cookie handles auth).
      partialize: (state) => ({ user: state.user }),
      onRehydrateStorage: () => (state) => {
        state?.markHydrated()
      },
    },
  ),
)
