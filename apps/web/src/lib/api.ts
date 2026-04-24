// ============================================================================
// URL resolution helpers (used by Phase 7 / Phase 9 debug pages and tests)
// ============================================================================

type ResolveApiBaseUrlInput = {
  explicitBase?: string
  legacyBase?: string
  pageHost?: string
}

export function normalizeApiBaseUrl(value: string) {
  if (!value) {
    return value
  }
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0'
}

export function resolveApiBaseUrlFromEnv({
  explicitBase,
  legacyBase,
  pageHost = 'localhost',
}: ResolveApiBaseUrlInput) {
  if (explicitBase) {
    return normalizeApiBaseUrl(explicitBase)
  }

  if (!legacyBase) {
    return '/api'
  }

  try {
    const legacyUrl = new URL(legacyBase)

    if (!isLoopbackHost(pageHost) && isLoopbackHost(legacyUrl.hostname)) {
      return '/api'
    }
  } catch {
    return '/api'
  }

  return normalizeApiBaseUrl(legacyBase)
}

export function resolveApiBaseUrl() {
  return resolveApiBaseUrlFromEnv({
    explicitBase: import.meta.env.VITE_API_BASE_URL,
    legacyBase: import.meta.env.VITE_API_URL,
    pageHost: window.location.hostname,
  })
}

export async function readJsonResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (!contentType.includes('application/json')) {
    const text = await response.text()
    return {
      data: null,
      message: text || `${response.status} ${response.statusText}`,
    }
  }

  return { data: await response.json(), message: null }
}

// ============================================================================
// Typed fetch client (used by app pages, hooks, and auth store)
// ============================================================================

export class ApiError extends Error {
  status: number
  code: string
  retryAfterSeconds?: number
  data?: Record<string, unknown>

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
    data?: Record<string, unknown>,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.data = data
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.code === 'NETWORK_ERROR') {
      return 'You appear to be offline. Check your connection and try again.'
    }
    if (error.status === 429) {
      const retryHint = error.retryAfterSeconds
        ? ` Try again in ${error.retryAfterSeconds}s.`
        : ' Please wait a moment and retry.'
      return `You are being rate limited.${retryHint}`
    }
    if (error.status >= 500) {
      return 'The service is temporarily degraded. Please retry in a moment.'
    }
    return error.message || fallback
  }

  if (error instanceof Error && /network|failed to fetch/i.test(error.message)) {
    return 'You appear to be offline. Check your connection and try again.'
  }

  return fallback
}

export function getToken(): string | null {
  return localStorage.getItem('fg_token')
}

export function setToken(t: string | null) {
  if (t) {
    localStorage.setItem('fg_token', t)
    return
  }

  localStorage.removeItem('fg_token')
}

/**
 * Typed fetch wrapper used by all app UI hooks.
 * Reads the API base URL dynamically at call time so it respects
 * the host-aware resolution logic above.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Resolve base URL at call time so ngrok/remote hosts work correctly.
  const base =
    typeof window !== 'undefined'
      ? resolveApiBaseUrl()
      : (import.meta.env.VITE_API_BASE_URL ?? '/api')

  const token = getToken()
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Network request failed',
    )
  }

  if (!res.ok) {
    const { data, message } = await readJsonResponse(res)
    const body = data as Record<string, string> | null
    const retryAfterHeader = res.headers.get('retry-after')
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined
    throw new ApiError(
      res.status,
      body?.code ?? 'UNKNOWN',
      body?.error ?? message ?? res.statusText,
      Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
      body ?? undefined,
    )
  }

  if (res.status === 204) {
    return undefined as T
  }

  return res.json() as Promise<T>
}
