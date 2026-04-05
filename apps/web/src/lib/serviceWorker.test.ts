import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  candidateLooksValidScript,
  isJavaScriptMime,
  registerBestServiceWorker,
} from './serviceWorker'

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator'
)
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')

function setNavigatorMock(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  })
}

function setFetchMock(fn: typeof fetch) {
  Object.defineProperty(globalThis, 'fetch', {
    value: fn,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  vi.restoreAllMocks()

  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
  }

  if (originalFetchDescriptor) {
    Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor)
  }
})

describe('serviceWorker helpers', () => {
  it('detects JavaScript MIME types', () => {
    expect(isJavaScriptMime('text/javascript')).toBe(true)
    expect(isJavaScriptMime('application/ecmascript; charset=utf-8')).toBe(true)
    expect(isJavaScriptMime('application/x-javascript')).toBe(true)
    expect(isJavaScriptMime('text/html')).toBe(false)
  })

  it('rejects candidate scripts when fetch is non-200', async () => {
    setFetchMock(
      vi.fn().mockResolvedValue(new Response('missing', { status: 404 })) as typeof fetch
    )

    const result = await candidateLooksValidScript('/sw-dev.js')

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('HTTP 404')
  })

  it('rejects candidate scripts when MIME is not JavaScript', async () => {
    setFetchMock(
      vi.fn().mockResolvedValue(
        new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      ) as typeof fetch
    )

    const result = await candidateLooksValidScript('/sw-dev.js')

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Expected JavaScript MIME')
  })
})

describe('registerBestServiceWorker', () => {
  it('throws when service worker API is unavailable', async () => {
    setNavigatorMock({})
    setFetchMock(vi.fn() as unknown as typeof fetch)

    await expect(registerBestServiceWorker()).rejects.toThrow(
      'Service worker API is not available in this browser.'
    )
  })

  it('registers the first valid candidate', async () => {
    const register = vi.fn().mockResolvedValue({ scope: '/' })
    setNavigatorMock({ serviceWorker: { register } })

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('self.addEventListener("fetch", () => {})', {
          status: 200,
          headers: { 'content-type': 'text/javascript' },
        })
      )
    setFetchMock(fetchMock as typeof fetch)

    await registerBestServiceWorker()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/sw-dev.js', { cache: 'no-store' })
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('/sw-dev.js', {
      scope: '/',
      type: 'classic',
    })
  })

  it('falls back to the next candidate when the first candidate is invalid', async () => {
    const register = vi.fn().mockResolvedValue({ scope: '/' })
    setNavigatorMock({ serviceWorker: { register } })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      )
      .mockResolvedValueOnce(
        new Response('export {}', {
          status: 200,
          headers: { 'content-type': 'text/javascript' },
        })
      )
    setFetchMock(fetchMock as typeof fetch)

    await registerBestServiceWorker()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('/dev-sw.js?dev-sw', {
      scope: '/',
      type: 'module',
    })
  })

  it('throws aggregated errors when no candidate succeeds', async () => {
    const register = vi.fn().mockResolvedValue({ scope: '/' })
    setNavigatorMock({ serviceWorker: { register } })

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('missing', {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'text/plain' },
        })
      )
    setFetchMock(fetchMock as typeof fetch)

    await expect(registerBestServiceWorker()).rejects.toThrow(
      'Unable to register a valid service worker script.'
    )
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(register).not.toHaveBeenCalled()
  })
})
