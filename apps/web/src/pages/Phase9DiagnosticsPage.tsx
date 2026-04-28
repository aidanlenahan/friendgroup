import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { readJsonResponse, resolveApiBaseUrl } from '../lib/api'

type NotificationConfig = {
  vapidPublicKey: string | null
  pushConfigured: boolean
  emailConfigured: boolean
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
      const { data, message } = await readJsonResponse(response)

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
      const { data, message } = await readJsonResponse(response)
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
    <main className="px-4 py-6 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex gap-3">
        <Link to="/" className="text-sm text-indigo-400 hover:text-indigo-300">← Home</Link>
        <Link to="/phase-7/debug" className="text-sm text-indigo-400 hover:text-indigo-300">Phase 7 Debug →</Link>
      </div>

      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400 mb-1">Gem</p>
        <h1 className="text-2xl font-bold text-white">Phase 9 Diagnostics</h1>
        <p className="text-sm text-gray-400 mt-1">
          Lightweight frontend diagnostics for API reachability and notification setup.
        </p>
      </header>

      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
        <h2 className="text-lg font-semibold text-white">API Connectivity Checks</h2>
        <p className="text-sm text-gray-400">Run quick checks against baseline API endpoints used by app workflows.</p>
        <div className="flex flex-wrap gap-2">
          <button
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-4 rounded-xl transition-colors"
            onClick={checkApiHealth}
          >
            Check API /health
          </button>
          <button
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2 px-4 rounded-xl transition-colors"
            onClick={checkNotificationConfig}
          >
            Check /notifications/config
          </button>
        </div>
      </section>

      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-2">
        <h2 className="text-lg font-semibold text-white">Runtime Status</h2>
        <p className="text-sm text-gray-400">API base URL: <span className="text-white">{apiBaseUrl}</span></p>
        <p className="text-sm text-gray-300">{status}</p>
      </section>

      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-2">
        <h2 className="text-lg font-semibold text-white">Health Response</h2>
        <pre className="text-xs text-gray-300 bg-gray-800 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">{healthJson}</pre>
      </section>

      <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-2">
        <h2 className="text-lg font-semibold text-white">Notification Config Summary</h2>
        <pre className="text-xs text-gray-300 bg-gray-800 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">{configSummary}</pre>
      </section>
    </main>
  )
}
