import { resolveApiBaseUrl } from './api'

// In-memory dedup: skip identical errors within 5 minutes.
const seen = new Map<string, number>()
const THROTTLE_MS = 5 * 60 * 1000

function shouldSend(key: string): boolean {
  const now = Date.now()
  const last = seen.get(key)
  if (last !== undefined && now - last < THROTTLE_MS) return false
  seen.set(key, now)
  if (seen.size > 50) {
    for (const [k, ts] of seen) {
      if (now - ts > THROTTLE_MS) seen.delete(k)
    }
  }
  return true
}

export function reportClientError(message: string, stack: string): void {
  const key = message.slice(0, 100)
  if (!shouldSend(key)) return

  const payload = {
    message: message.slice(0, 500),
    stack: stack.slice(0, 4000),
    url: window.location.href.slice(0, 500),
    userAgent: navigator.userAgent.slice(0, 300),
  }

  // Fire-and-forget — never block the UI or leak errors from the reporter itself
  fetch(`${resolveApiBaseUrl()}/internal/client-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Intentionally swallowed — the reporter must never throw
  })
}
