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