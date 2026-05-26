import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { initTheme } from './hooks/useTheme'
import { registerBestServiceWorker } from './lib/serviceWorker'
import { reportClientError } from './lib/reportClientError'

// Apply theme immediately to prevent flash of wrong theme on load
initTheme()

// Lock the app to the visual viewport height so iOS keyboard appearance never
// creates a secondary outer scroll. height:100% on html is based on the initial
// containing block (ICB), which doesn't shrink when the keyboard opens — the
// visual viewport does. Setting html height directly here keeps the whole 100%
// chain in sync with the actual visible area.
//
// Additionally, when iOS focuses a textarea it programmatically scrolls the
// document to bring that element into view (window.scrollY becomes non-zero).
// overflow:hidden blocks user-initiated scroll but NOT this browser-initiated
// programmatic scroll. The window 'scroll' listener catches it and immediately
// resets to (0,0) so the correctly-sized layout is always anchored at the top
// of the viewport — no manual swipe needed after the keyboard opens.
;(function lockToVisualViewport() {
  const vv = window.visualViewport
  if (!vv) return

  const resetScroll = () => {
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
  }

  const sync = () => {
    document.documentElement.style.height = vv.height + 'px'
    // rAF lets the layout settle before resetting scroll, so the reset wins
    // even if iOS applies its focus-scroll slightly after the resize event.
    requestAnimationFrame(resetScroll)
  }

  vv.addEventListener('resize', sync)
  window.addEventListener('scroll', resetScroll)
  sync()
})()

// Sentry is loaded lazily after first user interaction to avoid blocking LCP.
// The ~200 KB chunk is not needed until the user starts doing something.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim()

if (sentryDsn) {
  let sentryInitialized = false
  const initSentry = () => {
    if (sentryInitialized) return
    sentryInitialized = true
    import('@sentry/react').then((Sentry) => {
      Sentry.init({
        dsn: sentryDsn,
        environment: import.meta.env.MODE,
        release: import.meta.env.VITE_SENTRY_RELEASE,
        tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0),
        beforeSend(event) {
          if (event.request?.data) {
            delete event.request.data
          }
          if (event.request?.cookies) {
            delete event.request.cookies
          }
          if (event.request?.headers?.Authorization) {
            event.request.headers.Authorization = '[REDACTED]'
          }
          if (event.request?.headers?.authorization) {
            event.request.headers.authorization = '[REDACTED]'
          }
          return event
        },
      })
    })
  }

  const sentryEvents = ['click', 'keydown', 'touchstart', 'scroll'] as const
  const onFirstInteraction = () => {
    initSentry()
    sentryEvents.forEach((e) => window.removeEventListener(e, onFirstInteraction))
  }
  sentryEvents.forEach((e) => window.addEventListener(e, onFirstInteraction, { once: true, passive: true }))
  // Fallback: init after 5 seconds for users who never interact
  setTimeout(initSentry, 5000)
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return
  }

  try {
    const registration = await registerBestServiceWorker()
    console.info(`Service worker registered from ${registration.scope}.`)
  } catch (error) {
    console.error('Service worker registration failed:', error)
  }
}

void registerServiceWorker()

// Stale chunk recovery: after a new deploy, old chunk hashes are gone from the
// server. If any lazy-loaded chunk returns 404, reload so the new index.html
// takes over and references the correct hashes.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})

// Global error hooks — catch exceptions that escape React's tree and unhandled
// promise rejections. Both feed the same SMTP alerting pipeline as ErrorBoundary.
window.onerror = (_msg, _src, _line, _col, error) => {
  if (error) reportClientError(error.message, error.stack ?? '')
}
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  if (reason instanceof Error) {
    reportClientError(reason.message, reason.stack ?? '')
  } else if (reason) {
    reportClientError(String(reason), '')
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
