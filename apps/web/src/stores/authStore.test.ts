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
  }
  version: number
}

function seedPersistedAuth(user: PersistedAuthShape['state']['user']) {
  const value: PersistedAuthShape = {
    state: { user },
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
  const auth = await import('./authStore')
  return { useAuthStore: auth.useAuthStore }
}

describe('auth store persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('bootstraps user from localStorage for reload persistence', async () => {
    seedPersistedAuth({
      id: 'u_1',
      email: 'test@example.com',
      name: 'Test User',
    })

    const { useAuthStore } = await loadAuthModules()

    expect(useAuthStore.getState().user?.id).toBe('u_1')

    await waitForHydration(() => useAuthStore.getState().hydrated)
    expect(useAuthStore.getState().hydrated).toBe(true)
  })

  it('stays logged out when no persisted auth is present', async () => {
    const { useAuthStore } = await loadAuthModules()

    expect(useAuthStore.getState().user).toBeNull()

    await waitForHydration(() => useAuthStore.getState().hydrated)
    expect(useAuthStore.getState().hydrated).toBe(true)
  })

  it('logout clears user from store', async () => {
    seedPersistedAuth({
      id: 'u_1',
      email: 'test@example.com',
      name: 'Test User',
    })

    const { useAuthStore } = await loadAuthModules()

    // logout fires a POST which we don't need to await in tests
    useAuthStore.getState().logout()

    expect(useAuthStore.getState().user).toBeNull()
  })
})
