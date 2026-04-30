// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PersistedAuthShape = {
  state: {
    user: {
      id: string
      email: string
      name: string
      username?: string | null
      avatarUrl?: string | null
      theme?: string | null
      isAdmin?: boolean
    } | null
    token: string | null
  }
  version: number
}

function seedPersistedAuth(payload: PersistedAuthShape['state']) {
  const value: PersistedAuthShape = {
    state: payload,
    version: 0,
  }
  window.localStorage.setItem('fg-auth', JSON.stringify(value))
}

async function waitForHydration(check: () => boolean, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    if (check()) return
    await Promise.resolve()
  }
  throw new Error('auth store did not hydrate in time')
}

async function loadAuthModules() {
  vi.resetModules()
  const api = await import('../lib/api')
  const auth = await import('./authStore')
  return { api, useAuthStore: auth.useAuthStore }
}

describe('auth store persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('bootstraps token and user from localStorage for reload persistence', async () => {
    seedPersistedAuth({
      token: 'persisted-token',
      user: {
        id: 'u_1',
        email: 'test@example.com',
        name: 'Test User',
      },
    })

    const { api, useAuthStore } = await loadAuthModules()

    expect(useAuthStore.getState().token).toBe('persisted-token')
    expect(useAuthStore.getState().user?.id).toBe('u_1')
    expect(api.getToken()).toBe('persisted-token')

    await waitForHydration(() => useAuthStore.getState().hydrated)
    expect(useAuthStore.getState().hydrated).toBe(true)
  })

  it('stays logged out when no persisted auth is present', async () => {
    const { api, useAuthStore } = await loadAuthModules()

    expect(useAuthStore.getState().token).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
    expect(api.getToken()).toBeNull()

    await waitForHydration(() => useAuthStore.getState().hydrated)
    expect(useAuthStore.getState().hydrated).toBe(true)
  })

  it('logout clears in-memory token and persisted auth snapshot', async () => {
    seedPersistedAuth({
      token: 'persisted-token',
      user: {
        id: 'u_1',
        email: 'test@example.com',
        name: 'Test User',
      },
    })

    const { api, useAuthStore } = await loadAuthModules()

    useAuthStore.getState().logout()

    expect(useAuthStore.getState().token).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
    expect(api.getToken()).toBeNull()

    await Promise.resolve()
    const raw = window.localStorage.getItem('fg-auth')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw ?? '{}') as PersistedAuthShape
    expect(parsed.state.token).toBeNull()
    expect(parsed.state.user).toBeNull()
  })
})
