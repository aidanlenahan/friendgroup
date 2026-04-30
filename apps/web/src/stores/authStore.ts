import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
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
  hydrated: boolean
  login: (token: string, user: User) => void
  logout: () => void
  markHydrated: () => void
}

function persistAuthSnapshot(user: User | null, token: string | null) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      'fg-auth',
      JSON.stringify({
        state: { user, token },
        version: 0,
      }),
    )
  } catch {
    // Ignore storage write failures (quota/private mode); in-memory auth still works.
  }
}

function readPersistedAuth(): Pick<AuthState, 'user' | 'token'> {
  if (typeof window === 'undefined') {
    return { user: null, token: null }
  }

  try {
    const raw = window.localStorage.getItem('fg-auth')
    if (!raw) return { user: null, token: null }

    const parsed = JSON.parse(raw) as { state?: { user?: User | null; token?: string | null } }
    return {
      user: parsed.state?.user ?? null,
      token: parsed.state?.token ?? null,
    }
  } catch {
    return { user: null, token: null }
  }
}

const bootstrappedAuth = readPersistedAuth()
if (bootstrappedAuth.token) {
  setToken(bootstrappedAuth.token)
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: bootstrappedAuth.user,
      token: bootstrappedAuth.token,
      hydrated: false,
      login: (token, user) => {
        setToken(token)
        persistAuthSnapshot(user, token)
        set({ token, user })
      },
      logout: () => {
        setToken(null)
        persistAuthSnapshot(null, null)
        set({ token: null, user: null })
      },
      markHydrated: () => {
        set({ hydrated: true })
      },
    }),
    {
      name: 'fg-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, token: state.token }),
      onRehydrateStorage: () => (state) => {
        if (state?.token) setToken(state.token)
        state?.markHydrated()
      },
    },
  ),
)
