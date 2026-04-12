import { Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './stores/authStore'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import GroupsPage from './pages/GroupsPage'
import GroupPage from './pages/GroupPage'
import EventPage from './pages/EventPage'
import CreateEventPage from './pages/CreateEventPage'
import SettingsPage from './pages/SettingsPage'
import NotificationSettingsPage from './pages/NotificationSettingsPage'
import { Phase7DebugPage } from './pages/Phase7DebugPage'
import { Phase9DiagnosticsPage } from './pages/Phase9DiagnosticsPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
