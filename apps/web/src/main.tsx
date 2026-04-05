import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { registerBestServiceWorker } from './lib/serviceWorker'

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
