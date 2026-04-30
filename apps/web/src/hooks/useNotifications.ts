import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

type NotificationConfig = {
  vapidPublicKey: string | null
  pushConfigured: boolean
  emailConfigured: boolean
}

type NotificationPreference = {
  type: string
  channel: string
  enabled: boolean
}

type NotificationPreferencesResponse = {
  preferences: NotificationPreference[]
}

type TagPreferencesResponse = {
  groupId: string
  preferences: Array<{ tagId: string; tagName: string; subscribed: boolean }>
}

export function useNotificationConfig() {
  return useQuery({
    queryKey: ['notifications', 'config'],
    queryFn: () => apiFetch<NotificationConfig>('/notifications/config'),
  })
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => apiFetch<NotificationPreferencesResponse>('/notifications/preferences'),
  })
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: Array<{ type: string; channel: string; enabled: boolean }>) =>
      apiFetch('/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'preferences'] }),
  })
}

export function useTagPreferences(groupId: string) {
  return useQuery({
    queryKey: ['notifications', 'preferences', 'tags', groupId],
    queryFn: () => apiFetch<TagPreferencesResponse>(`/notifications/preferences/tags?groupId=${groupId}`),
    enabled: !!groupId,
  })
}

export function useUpdateTagPreference() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tagId, subscribed }: { tagId: string; subscribed: boolean }) =>
      apiFetch(`/notifications/preferences/tags/${tagId}`, {
        method: 'PUT',
        body: JSON.stringify({ subscribed }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'preferences', 'tags'] }),
  })
}

// ============================================================================
// Notification Inbox
// ============================================================================

export type InboxNotification = {
  id: string
  type: string
  title: string
  body: string
  url: string | null
  createdAt: string
}

type InboxResponse = {
  notifications: InboxNotification[]
}

const INBOX_KEY = ['notifications', 'inbox'] as const

export function useNotificationInbox() {
  return useQuery({
    queryKey: INBOX_KEY,
    queryFn: () => apiFetch<InboxResponse>('/notifications/inbox'),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

export function useDismissNotification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/notifications/inbox/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: INBOX_KEY })
      const previous = qc.getQueryData<InboxResponse>(INBOX_KEY)
      qc.setQueryData<InboxResponse>(INBOX_KEY, (old) =>
        old ? { notifications: old.notifications.filter((n) => n.id !== id) } : old,
      )
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(INBOX_KEY, context.previous)
    },
  })
}

export function useDismissAllNotifications() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch('/notifications/inbox', { method: 'DELETE' }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: INBOX_KEY })
      const previous = qc.getQueryData<InboxResponse>(INBOX_KEY)
      qc.setQueryData<InboxResponse>(INBOX_KEY, { notifications: [] })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(INBOX_KEY, context.previous)
    },
  })
}

