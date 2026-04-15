import { StrictMode } from 'react'
import * as Sentry from '@sentry/react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { registerBestServiceWorker } from './lib/serviceWorker'

const sentryDsn = import.meta.env.VITE_SENTRY_DSN

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0),
  })
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
