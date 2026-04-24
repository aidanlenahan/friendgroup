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
