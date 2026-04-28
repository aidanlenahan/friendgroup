import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { readJsonResponse, resolveApiBaseUrl } from '../lib/api'
import { registerBestServiceWorker } from '../lib/serviceWorker'

type NotificationConfig = {
  vapidPublicKey: string | null
  pushConfigured: boolean
  emailConfigured: boolean
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function vapidKeyToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

function isStandaloneDisplay() {
  return window.matchMedia('(display-mode: standalone)').matches
}

async function waitForServiceWorkerReady(timeoutMs = 10000) {
  const timeoutPromise = new Promise<never>((_, reject) => {
    window.setTimeout(() => {
      reject(new Error('Service worker did not become ready in time'))
    }, timeoutMs)
  })

  return Promise.race([navigator.serviceWorker.ready, timeoutPromise])
}

async function waitForActivation(
  registration: ServiceWorkerRegistration,
  timeoutMs = 30000
) {
  if (registration.active) {
    return registration
  }

  const worker = registration.installing ?? registration.waiting
  if (!worker) {
    return registration
  }

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('Service worker did not activate in time'))
    }, timeoutMs)

    const onStateChange = () => {
      if (worker.state === 'activated') {
        window.clearTimeout(timer)
        worker.removeEventListener('statechange', onStateChange)
        resolve()
      }
    }

    worker.addEventListener('statechange', onStateChange)
    onStateChange()
  })

  return registration
}

async function ensureServiceWorkerRegistration() {
  if (import.meta.env.DEV) {
    const created = await registerBestServiceWorker()
    return waitForActivation(created)
  }

  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) {
    return waitForActivation(existing)
  }

  const created = await registerBestServiceWorker()
  return waitForActivation(created)
}

function getNotificationPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  return window.Notification.permission
}

export function Phase7DebugPage() {
  const apiBaseUrl = useMemo(resolveApiBaseUrl, [])

  const [email, setEmail] = useState('owner@gem.dev')
  const [token, setToken] = useState('')
  const [config, setConfig] = useState<NotificationConfig | null>(null)
  const [status, setStatus] = useState('Idle.')
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    getNotificationPermissionState()
  )
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [subscriptionJson, setSubscriptionJson] = useState('No subscription yet.')
  const [resetting, setResetting] = useState(false)

  const pushSupported =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window

  const canInstall = Boolean(installPrompt)
  const isIos = isIosDevice()
  const isInstalled = isStandaloneDisplay()
  const shouldShowIosInstallHint = isIos && !isInstalled
  const [showIosModal, setShowIosModal] = useState(false)

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }

    const onInstalled = () => {
      setInstallPrompt(null)
      setStatus('App installed successfully.')
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function loginForDevToken() {
    setStatus('Requesting dev token...')
    try {
      const response = await fetch(`${apiBaseUrl}/auth/dev-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const { data, message } = await readJsonResponse(response)
      const payload = data as
        | { token: string; user: { email: string } }
        | { error?: string }
        | null

      if (!response.ok) {
        throw new Error(
          (payload && 'error' in payload && payload.error) ||
            message ||
            `Failed to request token (${response.status})`
        )
      }

      if (!payload || !('token' in payload) || !payload.token) {
        throw new Error('Dev token response did not include a token.')
      }

      setToken(payload.token)
      setStatus(`Authenticated as ${payload.user.email} via ${apiBaseUrl}.`)
    } catch (error) {
      setStatus(`Dev auth failed: ${(error as Error).message}`)
    }
  }

  async function loadNotificationConfig() {
    setStatus('Loading notification config...')
    try {
      const response = await fetch(`${apiBaseUrl}/notifications/config`)
      const { data, message } = await readJsonResponse(response)

      if (!response.ok) {
        throw new Error(
          message || `Unable to load notification config (${response.status})`
        )
      }

      const payload = data as NotificationConfig | null
      if (!payload) {
        throw new Error('Notification config response was empty.')
      }

      setConfig(payload)
      setStatus('Loaded notification config from API.')
    } catch (error) {
      setStatus(`Config load failed: ${(error as Error).message}`)
    }
  }

  async function subscribeToPush() {
    if (!pushSupported) {
      setStatus('Push APIs are not available in this browser.')
      return
    }

    if (isIosDevice() && !isStandaloneDisplay()) {
      setStatus(
        'On iOS, push subscription is only available after installing to Home Screen.'
      )
      return
    }

    if (!token) {
      setStatus('Get a dev token first so subscribe can be authenticated.')
      return
    }

    const activeConfig = config ?? (await (async () => {
      const response = await fetch(`${apiBaseUrl}/notifications/config`)
      const { data, message } = await readJsonResponse(response)
      if (!response.ok) {
        throw new Error(
          message || `Unable to load notification config (${response.status})`
        )
      }
      const payload = data as NotificationConfig | null
      if (!payload) {
        throw new Error('Notification config response was empty.')
      }
      setConfig(payload)
      return payload
    })())

    if (!activeConfig.pushConfigured || !activeConfig.vapidPublicKey) {
      setStatus('Push is not configured in the API environment.')
      return
    }

    try {
      setStatus('Requesting notification permission...')
      const nextPermission =
        permission === 'granted'
          ? permission
          : await window.Notification.requestPermission()

      setPermission(nextPermission)

      if (nextPermission !== 'granted') {
        setStatus('Notification permission was not granted.')
        return
      }

      setStatus('Ensuring service worker registration...')
      const registration = await ensureServiceWorkerRegistration()

      setStatus('Creating browser push subscription...')
      await waitForServiceWorkerReady(30000)

      if (!registration.pushManager) {
        throw new Error('PushManager is unavailable on active service worker registration')
      }

      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyToUint8Array(activeConfig.vapidPublicKey),
        }))

      const serialized = subscription.toJSON()
      const auth = serialized.keys?.auth
      const p256dh = serialized.keys?.p256dh

      if (!serialized.endpoint || !auth || !p256dh) {
        throw new Error('Subscription payload is missing endpoint or keys')
      }

      setStatus('Saving subscription to API...')
      const response = await fetch(`${apiBaseUrl}/notifications/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          endpoint: serialized.endpoint,
          keys: { auth, p256dh },
        }),
      })

      const { data, message } = await readJsonResponse(response)
      const payload = data as { error?: string } | null
      if (!response.ok) {
        throw new Error(
          (payload && payload.error) ||
            message ||
            `Subscribe request failed (${response.status})`
        )
      }

      setSubscriptionJson(JSON.stringify(serialized, null, 2))
      setStatus('Push subscription saved successfully.')
    } catch (error) {
      const message = (error as Error).message
      if (message.toLowerCase().includes('mime')) {
        setStatus(
          `Push subscribe failed: ${message}. Use "Reset SW + Subscription (Debug)", reload, then retry Step 1 and Step 2.`
        )
        return
      }

      setStatus(`Push subscribe failed: ${message}`)
    }
  }

  async function sendPushTest() {
    if (!token) {
      setStatus('Get a dev token first to call push test endpoint.')
      return
    }

    setStatus('Sending test push...')
    try {
      const response = await fetch(`${apiBaseUrl}/notifications/test/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: 'GEM PWA Test',
          body: 'If you can read this, Phase 7 push wiring works.',
        }),
      })
      const { data, message } = await readJsonResponse(response)
      const payload = data as { error?: string } | null

      if (!response.ok) {
        throw new Error(
          (payload && payload.error) ||
            message ||
            `Push test failed (${response.status})`
        )
      }

      setStatus('Push test sent. Check your system notifications.')
    } catch (error) {
      setStatus(`Push test failed: ${(error as Error).message}`)
    }
  }

  async function resetServiceWorkerAndSubscription() {
    if (!('serviceWorker' in navigator)) {
      setStatus('Service worker API is not available in this browser.')
      return
    }

    setResetting(true)
    setStatus('Resetting service worker, push subscription, and local caches...')

    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      let unsubscribedCount = 0

      for (const registration of registrations) {
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) {
          const unsubscribed = await subscription.unsubscribe()
          if (unsubscribed) {
            unsubscribedCount += 1
          }
        }
      }

      await Promise.all(registrations.map((registration) => registration.unregister()))

      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }

      setConfig(null)
      setToken('')
      setPermission(getNotificationPermissionState())
      setSubscriptionJson('No subscription yet.')
      setStatus(
        `Reset complete. Unsubscribed ${unsubscribedCount} local push subscription(s). Reload then run Step 1 and Step 2 again.`
      )
    } catch (error) {
      setStatus(`Reset failed: ${(error as Error).message}`)
    } finally {
      setResetting(false)
    }
  }

  async function promptInstall() {
    if (shouldShowIosInstallHint) {
      setShowIosModal(true)
      return
    }

    if (!installPrompt) {
      setStatus('Install prompt is not available right now.')
      return
    }

    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    setInstallPrompt(null)
    if (choice.outcome === 'accepted') {
      setStatus('Install prompt accepted.')
    } else {
      setStatus('Install prompt dismissed.')
    }
  }

  const btnBase = 'bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold py-2 px-4 rounded-xl transition-colors'
  const sectionCls = 'bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3'

  return (
    <main className="px-4 py-6 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex gap-3">
        <Link to="/" className="text-sm text-indigo-400 hover:text-indigo-300">← Home</Link>
        <Link to="/phase-9/diagnostics" className="text-sm text-indigo-400 hover:text-indigo-300">Phase 9 Diagnostics →</Link>
      </div>

      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400 mb-1">GEM</p>
        <h1 className="text-2xl font-bold text-white">Phase 7 PWA Console</h1>
        <p className="text-sm text-gray-400 mt-1">
          Validates installability plus push permission and subscription flow.
        </p>
      </header>

      <section className={sectionCls}>
        <h2 className="text-lg font-semibold text-white">Step 1: Dev Authentication</h2>
        <p className="text-sm text-gray-400">Request a JWT via the dev-token endpoint to authenticate subscription and test routes.</p>
        <label htmlFor="email-input" className="block text-sm text-gray-400">User email</label>
        <div className="flex gap-2 flex-wrap">
          <input
            id="email-input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="owner@gem.dev"
            type="email"
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button className={btnBase} onClick={loginForDevToken}>Get Dev Token</button>
        </div>
        <p className="text-sm text-gray-400">
          Token status: <span className={token ? 'text-green-400' : 'text-yellow-400'}>{token ? 'Authenticated' : 'Not authenticated'}</span>
        </p>
      </section>

      <section className={sectionCls}>
        <h2 className="text-lg font-semibold text-white">Step 2: Notification Capability</h2>
        <p className="text-sm text-gray-400">Load server config and verify browser support before permission and subscription calls.</p>
        <div className="flex flex-wrap gap-2">
          <button className={btnBase} onClick={loadNotificationConfig}>Load /notifications/config</button>
          <button className={btnBase} onClick={subscribeToPush}>Request Permission + Subscribe</button>
          <button className={btnBase} onClick={sendPushTest}>Send Push Test</button>
          <button className={btnBase} onClick={resetServiceWorkerAndSubscription} disabled={resetting}>
            {resetting ? 'Resetting...' : 'Reset SW + Subscription (Debug)'}
          </button>
        </div>
        <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
          <li>Browser push support: <span className="text-white">{pushSupported ? 'yes' : 'no'}</span></li>
          <li>Notification permission: <span className="text-white">{permission}</span></li>
          <li>API push configured: <span className="text-white">{config ? (config.pushConfigured ? 'yes' : 'no') : 'unknown'}</span></li>
          <li>API email configured: <span className="text-white">{config ? (config.emailConfigured ? 'yes' : 'no') : 'unknown'}</span></li>
          <li>VAPID key loaded: <span className="text-white">{config?.vapidPublicKey ? 'yes' : 'no'}</span></li>
        </ul>
      </section>

      <section className={sectionCls}>
        <h2 className="text-lg font-semibold text-white">Step 3: Install App</h2>
        <p className="text-sm text-gray-400">Install prompts are browser controlled.</p>
        {!isInstalled ? (
          <button className={btnBase} onClick={promptInstall} disabled={!canInstall && !shouldShowIosInstallHint}>
            {shouldShowIosInstallHint ? 'How to Install on iPhone / iPad' : 'Install GEM PWA'}
          </button>
        ) : (
          <p className="text-sm text-green-400">✓ Already installed as a PWA.</p>
        )}
      </section>

      {showIosModal ? (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowIosModal(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white">Add to Home Screen</h2>
            <ol className="text-sm text-gray-300 space-y-2 list-decimal list-inside">
              <li>Tap the <strong className="text-white">Share</strong> button <span aria-label="Share">⬆</span> at the bottom of Safari.</li>
              <li>Scroll down and tap <strong className="text-white">"Add to Home Screen"</strong>.</li>
              <li>Tap <strong className="text-white">"Add"</strong> in the top-right corner.</li>
            </ol>
            <button className={btnBase} onClick={() => setShowIosModal(false)}>Got it</button>
          </div>
        </div>
      ) : null}

      <section className={sectionCls}>
        <h2 className="text-lg font-semibold text-white">Runtime Status</h2>
        <p className="text-sm text-gray-400">API base URL: <span className="text-white">{apiBaseUrl}</span></p>
        <p className="text-sm text-gray-300">{status}</p>
        <h3 className="text-sm font-semibold text-gray-200 mt-2">Subscription JSON</h3>
        <pre className="text-xs text-gray-300 bg-gray-800 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">{subscriptionJson}</pre>
      </section>
    </main>
  )
}
