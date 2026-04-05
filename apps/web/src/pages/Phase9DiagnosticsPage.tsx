import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

type NotificationConfig = {
  vapidPublicKey: string | null
  pushConfigured: boolean
  emailConfigured: boolean
}

function normalizeApiBaseUrl(value: string) {
  if (!value) {
    return value
  }
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function resolveApiBaseUrl() {
  const explicitBase = import.meta.env.VITE_API_BASE_URL
  if (explicitBase) {
    return normalizeApiBaseUrl(explicitBase)
  }

  const legacyBase = import.meta.env.VITE_API_URL
  if (!legacyBase) {
    return '/api'
  }

  try {
    const legacyUrl = new URL(legacyBase)
    const pageHost = window.location.hostname
    const pageIsLoopback =
      pageHost === 'localhost' || pageHost === '127.0.0.1' || pageHost === '0.0.0.0'
    const legacyIsLoopback =
      legacyUrl.hostname === 'localhost' ||
      legacyUrl.hostname === '127.0.0.1' ||
      legacyUrl.hostname === '0.0.0.0'

    if (!pageIsLoopback && legacyIsLoopback) {
      return '/api'
    }
  } catch {
    return '/api'
  }

  return normalizeApiBaseUrl(legacyBase)
}

async function parseJsonMessage(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    const text = await response.text()
    return { data: null, message: text || `${response.status} ${response.statusText}` }
  }

  return { data: await response.json(), message: null }
}

export function Phase9DiagnosticsPage() {
  const apiBaseUrl = useMemo(resolveApiBaseUrl, [])
  const [status, setStatus] = useState('Idle.')
  const [healthJson, setHealthJson] = useState('No health response yet.')
  const [configSummary, setConfigSummary] = useState('No notification config fetched yet.')

  async function checkApiHealth() {
    setStatus('Checking /health endpoint...')
    try {
      const response = await fetch(`${apiBaseUrl}/health`)
      const { data, message } = await parseJsonMessage(response)

      if (!response.ok) {
        throw new Error(message || `Health check failed (${response.status})`)
      }

      setHealthJson(JSON.stringify(data, null, 2))
      setStatus('API health endpoint is reachable.')
    } catch (error) {
      setStatus(`Health check failed: ${(error as Error).message}`)
    }
  }

  async function checkNotificationConfig() {
    setStatus('Checking /notifications/config endpoint...')
    try {
      const response = await fetch(`${apiBaseUrl}/notifications/config`)
      const { data, message } = await parseJsonMessage(response)
      const payload = data as NotificationConfig | null

      if (!response.ok) {
        throw new Error(message || `Notification config failed (${response.status})`)
      }

      if (!payload) {
        throw new Error('Notification config payload was empty.')
      }

      const summary = [
        `pushConfigured: ${payload.pushConfigured ? 'yes' : 'no'}`,
        `emailConfigured: ${payload.emailConfigured ? 'yes' : 'no'}`,
        `vapidPublicKey: ${payload.vapidPublicKey ? 'present' : 'missing'}`,
      ].join('\n')

      setConfigSummary(summary)
      setStatus('Notification config fetched successfully.')
    } catch (error) {
      setStatus(`Notification config failed: ${(error as Error).message}`)
    }
  }

  return (
    <main className="app-shell">
      <section className="panel top-nav-panel">
        <div className="row">
          <Link className="button-link" to="/">
            Home
          </Link>
          <Link className="button-link" to="/phase-7/debug">
            Phase 7 Debug
          </Link>
        </div>
      </section>

      <header className="hero">
        <p className="eyebrow">Friendgroup</p>
        <h1>Phase 9 Diagnostics</h1>
        <p>
          Lightweight frontend diagnostics for API reachability and notification setup.
          This is the Phase 9 landing surface for future test and quality tooling.
        </p>
      </header>

      <section className="panel">
        <h2>API Connectivity Checks</h2>
        <p>Run quick checks against baseline API endpoints used by app workflows.</p>
        <div className="row">
          <button onClick={checkApiHealth}>Check API /health</button>
          <button onClick={checkNotificationConfig}>Check /notifications/config</button>
        </div>
      </section>

      <section className="panel">
        <h2>Runtime Status</h2>
        <p className="status">API base URL: {apiBaseUrl}</p>
        <p className="status">{status}</p>
      </section>

      <section className="panel">
        <h2>Health Response</h2>
        <pre>{healthJson}</pre>
      </section>

      <section className="panel">
        <h2>Notification Config Summary</h2>
        <pre>{configSummary}</pre>
      </section>
    </main>
  )
}
