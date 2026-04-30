import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useAuthStore } from './stores/authStore'
import { ApiError, apiFetch } from './lib/api'
import { useThemeApplier } from './hooks/useTheme'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import GroupsPage from './pages/GroupsPage'
import GroupPage from './pages/GroupPage'
import GroupManagePage from './pages/GroupManagePage'
import EventPage from './pages/EventPage'
import CreateEventPage from './pages/CreateEventPage'
import SettingsPage from './pages/SettingsPage'
import ProfilePage from './pages/ProfilePage'
import UserProfilePage from './pages/UserProfilePage'
import NotificationSettingsPage from './pages/NotificationSettingsPage'
import ChannelPage from './pages/ChannelPage'
import { Phase7DebugPage } from './pages/Phase7DebugPage'
import { Phase9DiagnosticsPage } from './pages/Phase9DiagnosticsPage'
import DeveloperPage from './pages/DeveloperPage'
import MarketingLayout from './components/MarketingLayout'
import LandingPage from './pages/LandingPage'
import HelpPage from './pages/HelpPage'
import ContactPage from './pages/ContactPage'
import NotFoundPage from './pages/NotFoundPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const apiError = error instanceof ApiError ? error : null
        if (apiError?.status === 401 || apiError?.status === 403 || apiError?.status === 404) {
          return false
        }

        if (apiError?.status === 429 || (apiError && apiError.status >= 500) || apiError?.status === 0) {
          return failureCount < 3
        }

        return failureCount < 2
      },
      retryDelay: (attemptIndex, error) => {
        if (error instanceof ApiError && error.status === 429 && error.retryAfterSeconds) {
          return error.retryAfterSeconds * 1000
        }

        const base = 600
        return Math.min(base * 2 ** attemptIndex, 5_000)
      },
    },
  },
})

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray.buffer
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const hydrated = useAuthStore((s) => s.hydrated)
  const location = useLocation()
  if (!hydrated) {
    return null
  }
  if (token) {
    return <>{children}</>
  }

  const next = `${location.pathname}${location.search}${location.hash}`
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const hydrated = useAuthStore((s) => s.hydrated)
  const location = useLocation()
  if (!hydrated) {
    return null
  }
  const next = new URLSearchParams(location.search).get('next')
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/groups'
  return token ? <Navigate to={target} replace /> : <>{children}</>
}

function RootRedirect() {
  const token = useAuthStore((s) => s.token)
  const hydrated = useAuthStore((s) => s.hydrated)
  if (!hydrated) return null
  return <Navigate to={token ? '/groups' : '/home'} replace />
}

export default function App() {
  useThemeApplier()
  const { token, user, login, hydrated } = useAuthStore()

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-200 flex items-center justify-center">
        <p className="text-sm text-gray-400">Restoring your session...</p>
      </div>
    )
  }

  // Refresh user profile on mount so isAdmin and other fields stay in sync
  useEffect(() => {
    if (!token || !user) return
    apiFetch<{ user: typeof user & { isAdmin?: boolean } }>('/users/me')
      .then((data) => { if (data.user) login(token, data.user) })
      .catch(() => {/* silently ignore — stale store data is acceptable */})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep push subscription healthy on app boot so background notifications
  // continue to work after SW updates or browser subscription invalidations.
  useEffect(() => {
    if (!token) return
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return
    if (Notification.permission !== 'granted') return

    let canceled = false

    const syncPushSubscription = async () => {
      try {
        const [{ vapidPublicKey }, prefs] = await Promise.all([
          apiFetch<{ vapidPublicKey: string | null }>('/notifications/config'),
          apiFetch<{ preferences: Array<{ type: string; channel: string; enabled: boolean }> }>('/notifications/preferences'),
        ])

        if (!vapidPublicKey || canceled) return

        const anyPushEnabled = prefs.preferences
          .filter((pref) => pref.channel === 'push')
          .some((pref) => pref.enabled)

        if (!anyPushEnabled) return

        const registration = await navigator.serviceWorker.ready
        let subscription = await registration.pushManager.getSubscription()

        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
          })
        }

        const subJson = subscription.toJSON()
        if (!subJson.endpoint || !subJson.keys?.auth || !subJson.keys?.p256dh) return

        await apiFetch('/notifications/subscribe', {
          method: 'POST',
          body: JSON.stringify({
            endpoint: subJson.endpoint,
            keys: {
              auth: subJson.keys.auth,
              p256dh: subJson.keys.p256dh,
            },
          }),
        })
      } catch {
        // best-effort reconciliation; leave explicit errors to settings UI
      }
    }

    void syncPushSubscription()
    return () => {
      canceled = true
    }
  }, [token])

  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        {/* Public routes — MarketingLayout wraps the public landing and auth pages */}
        <Route path="/" element={<MarketingLayout />}>
          <Route index element={<RootRedirect />} />
          <Route path="home" element={<LandingPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
          <Route path="register" element={<RedirectIfAuthed><RegisterPage /></RedirectIfAuthed>} />
          <Route path="verify-email" element={<VerifyEmailPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
        </Route>
        {/* Legacy debug/diagnostic routes */}
        <Route path="/phase-7/debug" element={<Phase7DebugPage />} />
        <Route path="/phase-9/diagnostics" element={<Phase9DiagnosticsPage />} />
        {/* Authenticated routes — RequireAuth redirects to /login if no token */}
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/:groupId" element={<GroupPage />} />
          <Route path="/groups/:groupId/manage" element={<GroupManagePage />} />
          <Route path="/groups/:groupId/events/new" element={<CreateEventPage />} />
          <Route path="/events/:eventId" element={<EventPage />} />
          <Route path="/groups/:groupId/channels/:channelId" element={<ChannelPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/u/:username" element={<UserProfilePage />} />
          <Route path="/developer" element={<DeveloperPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </QueryClientProvider>
  )
}
