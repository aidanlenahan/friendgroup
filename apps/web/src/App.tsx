import { Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './stores/authStore'
import { ApiError } from './lib/api'
import { useThemeApplier } from './hooks/useTheme'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import GroupsPage from './pages/GroupsPage'
import GroupPage from './pages/GroupPage'
import EventPage from './pages/EventPage'
import CreateEventPage from './pages/CreateEventPage'
import SettingsPage from './pages/SettingsPage'
import NotificationSettingsPage from './pages/NotificationSettingsPage'
import { Phase7DebugPage } from './pages/Phase7DebugPage'
import { Phase9DiagnosticsPage } from './pages/Phase9DiagnosticsPage'

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
          <Route path="/groups/:groupId/events/new" element={<CreateEventPage />} />
          <Route path="/events/:eventId" element={<EventPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </QueryClientProvider>
  )
}
