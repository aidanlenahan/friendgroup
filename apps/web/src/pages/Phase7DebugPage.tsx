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

  const [email, setEmail] = useState('owner@friendgroup.dev')
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
          title: 'Friendgroup PWA Test',
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

  return (
    <main className="app-shell">
      <section className="panel top-nav-panel">
        <div className="row">
          <Link className="button-link" to="/">
            Home
          </Link>
          <Link className="button-link" to="/phase-9/diagnostics">
            Phase 9 Diagnostics
          </Link>
        </div>
      </section>

      <header className="hero">
        <p className="eyebrow">Friendgroup</p>
        <h1>Phase 7 PWA Console</h1>
        <p>
          This screen validates installability plus push permission and subscription
          flow, aligned with the PRD and the notification setup guide.
        </p>
      </header>

      <section className="panel">
        <h2>Step 1: Dev Authentication</h2>
        <p>
          Request a JWT using the API dev-token endpoint so subscription and test
          routes can be called with auth.
        </p>
        <label htmlFor="email-input">User email</label>
        <div className="row">
          <input
            id="email-input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="owner@friendgroup.dev"
            type="email"
          />
          <button onClick={loginForDevToken}>Get Dev Token</button>
        </div>
        <p className="status">
          Token status: {token ? 'Authenticated' : 'Not authenticated'}
        </p>
      </section>

      <section className="panel">
        <h2>Step 2: Notification Capability</h2>
        <p>
          Load server config and verify browser support before permission and
          subscription calls.
        </p>
        <div className="row">
          <button onClick={loadNotificationConfig}>Load /notifications/config</button>
          <button onClick={subscribeToPush}>Request Permission + Subscribe</button>
          <button onClick={sendPushTest}>Send Push Test</button>
          <button onClick={resetServiceWorkerAndSubscription} disabled={resetting}>
            {resetting ? 'Resetting...' : 'Reset SW + Subscription (Debug)'}
          </button>
        </div>

        <ul className="facts">
          <li>Browser push support: {pushSupported ? 'yes' : 'no'}</li>
          <li>Notification permission: {permission}</li>
          <li>
            API push configured:{' '}
            {config ? (config.pushConfigured ? 'yes' : 'no') : 'unknown'}
          </li>
          <li>API email configured: {config ? (config.emailConfigured ? 'yes' : 'no') : 'unknown'}</li>
          <li>VAPID key loaded: {config?.vapidPublicKey ? 'yes' : 'no'}</li>
        </ul>
      </section>

      <section className="panel">
        <h2>Step 3: Install App</h2>
        <p>
          Install prompts are browser controlled. This button appears when the
          beforeinstallprompt event is available.
        </p>
        {!isInstalled ? (
          <div className="row">
            <button onClick={promptInstall} disabled={!canInstall && !shouldShowIosInstallHint}>
              {shouldShowIosInstallHint ? 'How to Install on iPhone / iPad' : 'Install Friendgroup PWA'}
            </button>
          </div>
        ) : (
          <p className="hint">✓ Already installed as a PWA.</p>
        )}
      </section>

      {showIosModal ? (
        <div className="modal-overlay" onClick={() => setShowIosModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add to Home Screen</h2>
            <ol className="ios-steps">
              <li>
                Tap the <strong>Share</strong> button{' '}
                <span className="ios-icon" aria-label="Share">⬆</span>{' '}
                at the bottom of Safari.
              </li>
              <li>
                Scroll down and tap{' '}
                <strong>"Add to Home Screen"</strong>.
              </li>
              <li>
                Tap <strong>"Add"</strong> in the top-right corner.
              </li>
            </ol>
            <button onClick={() => setShowIosModal(false)}>Got it</button>
          </div>
        </div>
      ) : null}

      <section className="panel">
        <h2>Runtime Status</h2>
        <p className="status">API base URL: {apiBaseUrl}</p>
        <p className="status">{status}</p>
        <h3>Subscription JSON</h3>
        <pre>{subscriptionJson}</pre>
      </section>
    </main>
  )
}
