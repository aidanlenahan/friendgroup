type ServiceWorkerScriptType = 'classic' | 'module'

type ServiceWorkerCandidate = {
  url: string
  type: ServiceWorkerScriptType
  label: string
}

export function isJavaScriptMime(contentType: string) {
  const normalized = contentType.toLowerCase()
  return (
    normalized.includes('javascript') ||
    normalized.includes('ecmascript') ||
    normalized.includes('application/x-javascript')
  )
}

export async function candidateLooksValidScript(url: string) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    return {
      valid: false,
      reason: `HTTP ${response.status} ${response.statusText}`,
    }
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!isJavaScriptMime(contentType)) {
    return {
      valid: false,
      reason: `Expected JavaScript MIME but got '${contentType || 'unknown'}'`,
    }
  }

  return { valid: true, reason: '' }
}

export async function registerBestServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service worker API is not available in this browser.')
  }

  const candidates: ServiceWorkerCandidate[] = [
    {
      // public/ static file — Vite always serves this as text/javascript,
      // no vite-plugin-pwa compilation required, no Host-header blocking.
      url: '/sw-dev.js',
      type: 'classic',
      label: 'public static dev worker',
    },
    {
      url: '/dev-sw.js?dev-sw',
      type: 'module',
      label: 'vite-pwa dev worker',
    },
    {
      url: '/sw.js',
      type: 'classic',
      label: 'classic production worker',
    },
    {
      url: '/sw.js',
      type: 'module',
      label: 'module production worker',
    },
  ]

  const errors: string[] = []

  for (const candidate of candidates) {
    try {
      const probe = await candidateLooksValidScript(candidate.url)
      if (!probe.valid) {
        errors.push(`${candidate.label}: ${probe.reason}`)
        continue
      }

      return await navigator.serviceWorker.register(candidate.url, {
        scope: '/',
        type: candidate.type,
      })
    } catch (error) {
      const message = (error as Error).message || 'Unknown registration error'
      errors.push(`${candidate.label}: ${message}`)
    }
  }

  throw new Error(
    `Unable to register a valid service worker script. ${errors.join(' | ')}`
  )
}
