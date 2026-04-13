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

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message)
    this.status = status
    this.code = code
  }
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
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })

  if (!res.ok) {
    const { data, message } = await readJsonResponse(res)
    const body = data as Record<string, string> | null
    throw new ApiError(
      res.status,
      body?.code ?? 'UNKNOWN',
      body?.error ?? message ?? res.statusText,
    )
  }

  if (res.status === 204) {
    return undefined as T
  }

  return res.json() as Promise<T>
}
