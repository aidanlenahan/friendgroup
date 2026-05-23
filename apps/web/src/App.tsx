import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, lazy, Suspense } from 'react'
import { useAuthStore } from './stores/authStore'
import { ApiError, apiFetch } from './lib/api'
import { useThemeApplier } from './hooks/useTheme'
import Layout from './components/Layout'
import MarketingLayout from './components/MarketingLayout'
import { queryClient } from './lib/queryClient'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const GroupsPage = lazy(() => import('./pages/GroupsPage'))
const GroupPage = lazy(() => import('./pages/GroupPage'))
const GroupManagePage = lazy(() => import('./pages/GroupManagePage'))
const EventPage = lazy(() => import('./pages/EventPage'))
const CreateEventPage = lazy(() => import('./pages/CreateEventPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const UserProfilePage = lazy(() => import('./pages/UserProfilePage'))
const NotificationSettingsPage = lazy(() => import('./pages/NotificationSettingsPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const ChannelPage = lazy(() => import('./pages/ChannelPage'))
const Phase7DebugPage = lazy(() => import('./pages/Phase7DebugPage').then(m => ({ default: m.Phase7DebugPage })))
const Phase9DiagnosticsPage = lazy(() => import('./pages/Phase9DiagnosticsPage').then(m => ({ default: m.Phase9DiagnosticsPage })))
const DeveloperPage = lazy(() => import('./pages/DeveloperPage'))
const LandingPage = lazy(() => import('./pages/LandingPage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const HelpArticlePage = lazy(() => import('./pages/HelpArticlePage'))
const ContactPage = lazy(() => import('./pages/ContactPage'))
const UpdatesPage = lazy(() => import('./pages/UpdatesPage'))
const GroupStatsPage = lazy(() => import('./pages/GroupStatsPage'))
const GroupGalleryPage = lazy(() => import('./pages/GroupGalleryPage'))
const DemoPage = lazy(() => import('./pages/DemoPage'))
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'))
const TermsOfServicePage = lazy(() => import('./pages/TermsOfServicePage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))


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
  const user = useAuthStore((s) => s.user)
  const hydrated = useAuthStore((s) => s.hydrated)
  const location = useLocation()
  if (!hydrated) {
    return null
  }
  if (user) {
    return <>{children}</>
  }

  const next = `${location.pathname}${location.search}${location.hash}`
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const hydrated = useAuthStore((s) => s.hydrated)
  const location = useLocation()
  if (!hydrated) {
    return null
  }
  const next = new URLSearchParams(location.search).get('next')
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/groups'
  return user ? <Navigate to={target} replace /> : <>{children}</>
}

function RootRedirect() {
  const user = useAuthStore((s) => s.user)
  const hydrated = useAuthStore((s) => s.hydrated)
  if (!hydrated) return null
  return <Navigate to={user ? '/groups' : '/home'} replace />
}

export default function App() {
  useThemeApplier()
  const { user, login, logout, hydrated } = useAuthStore()

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-200 flex items-center justify-center">
        <p className="text-sm text-gray-400">Restoring your session...</p>
      </div>
    )
  }

  // On mount, silently re-validate the session cookie and refresh user profile.
  // Skip for demo users — their token already has the right expiry.
  useEffect(() => {
    if (!user) return
    if (user.isDemo) return
    apiFetch<{ user: typeof user & { isAdmin?: boolean } }>('/users/me')
      .then((data) => { if (data.user) login(data.user) })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) logout()
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep push subscription healthy on app boot so background notifications
  // continue to work after SW updates or browser subscription invalidations.
  useEffect(() => {
    if (!user) return
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

        // No push prefs saved yet → treat as all-enabled (matches server-side default)
        const pushPrefs = prefs.preferences.filter((pref) => pref.channel === 'push')
        const anyPushEnabled = pushPrefs.length === 0 || pushPrefs.some((pref) => pref.enabled)

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
  }, [user])

  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div className="h-full bg-gray-950" />}>
      <Routes>
        {/* Public routes — MarketingLayout wraps the public landing and auth pages */}
        <Route path="/" element={<MarketingLayout />}>
          <Route index element={<RootRedirect />} />
          <Route path="home" element={<LandingPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="help/:slug" element={<HelpArticlePage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="updates" element={<UpdatesPage />} />
          <Route path="about" element={<Navigate to="/updates" replace />} />
          <Route path="demo" element={<DemoPage />} />
          <Route path="privacy" element={<PrivacyPolicyPage />} />
          <Route path="terms" element={<TermsOfServicePage />} />
          <Route path="login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
          <Route path="register" element={<RedirectIfAuthed><RegisterPage /></RedirectIfAuthed>} />
          <Route path="verify-email" element={<VerifyEmailPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
        </Route>
        {/* Legacy debug/diagnostic routes */}
        <Route path="/phase-7/debug" element={<Phase7DebugPage />} />
        <Route path="/phase-9/diagnostics" element={<Phase9DiagnosticsPage />} />
        {/* Authenticated routes — RequireAuth redirects to /login if no user */}
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
          <Route path="/groups/:groupId/stats" element={<GroupStatsPage />} />
          <Route path="/groups/:groupId/gallery" element={<GroupGalleryPage />} />
          <Route path="/groups/:groupId/events/new" element={<CreateEventPage />} />
          <Route path="/events/:eventId" element={<EventPage />} />
          <Route path="/groups/:groupId/channels/:channelId" element={<ChannelPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/u/:username" element={<UserProfilePage />} />
          <Route path="/developer" element={<DeveloperPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
    </QueryClientProvider>
  )
}
