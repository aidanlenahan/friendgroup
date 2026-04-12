// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Phase9DiagnosticsPage } from './Phase9DiagnosticsPage'

const originalFetch = globalThis.fetch

function renderPage() {
  return render(
    <MemoryRouter>
      <Phase9DiagnosticsPage />
    </MemoryRouter>
  )
}

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
})

describe('Phase9DiagnosticsPage', () => {
  it('loads health status successfully', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      ),
    })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Check API /health' }))

    await screen.findByText('API health endpoint is reachable.')
    expect(screen.getByText(/"status": "ok"/)).toBeTruthy()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('shows notification config errors', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue(
        new Response('Gateway unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'content-type': 'text/plain' },
        })
      ),
    })

    renderPage()
    await userEvent.click(
      screen.getByRole('button', { name: 'Check /notifications/config' })
    )

    await screen.findByText('Notification config failed: Gateway unavailable')
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })
  })
})