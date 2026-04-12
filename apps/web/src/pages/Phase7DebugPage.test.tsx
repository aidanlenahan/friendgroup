// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Phase7DebugPage } from './Phase7DebugPage'

const originalFetch = globalThis.fetch
const originalMatchMedia = window.matchMedia

function renderPage() {
  return render(
    <MemoryRouter>
      <Phase7DebugPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      media: '(display-mode: standalone)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()

  if (originalFetch) {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    })
  }

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  })
})

describe('Phase7DebugPage', () => {
  it('authenticates through the dev token endpoint', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            token: 'token-123',
            user: { email: 'owner@friendgroup.dev', id: 'u1', name: 'Owner' },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      ),
    })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Get Dev Token' }))

    await screen.findByText(/Authenticated as owner@friendgroup.dev via /)
    await screen.findByText('Token status: Authenticated')
  })

  it('shows notification config failure states', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue(
        new Response('Config offline', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'content-type': 'text/plain' },
        })
      ),
    })

    renderPage()
    await userEvent.click(
      screen.getByRole('button', { name: 'Load /notifications/config' })
    )

    await screen.findByText('Config load failed: Config offline')
  })

  it('blocks push tests until authentication is available', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Send Push Test' }))

    await screen.findByText('Get a dev token first to call push test endpoint.')
  })
})