import { Routes, Route, Navigate } from 'react-router-dom'
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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  useThemeApplier()
  const { token, user, login } = useAuthStore()

  // Refresh user profile on mount so isAdmin and other fields stay in sync
  useEffect(() => {
    if (!token || !user) return
    apiFetch<{ user: typeof user & { isAdmin?: boolean } }>('/users/me')
      .then((data) => { if (data.user) login(token, data.user) })
      .catch(() => {/* silently ignore — stale store data is acceptable */})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Legacy debug/diagnostic routes */}
        <Route path="/phase-7/debug" element={<Phase7DebugPage />} />
        <Route path="/phase-9/diagnostics" element={<Phase9DiagnosticsPage />} />
        {/* Authenticated routes */}
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/groups" replace />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </QueryClientProvider>
  )
}
