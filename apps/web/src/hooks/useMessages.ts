import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

export type EventMessage = {
  id: string
  text: string
  createdAt: string
  pinned?: boolean
  user?: { id: string; name: string; avatarUrl?: string | null }
  reactions?: Array<{ userId: string; emoji: string }>
}

export type EventMessagesPage = {
  messages: EventMessage[]
  nextCursor?: string | null
}

export type ChannelMessage = {
  id: string
  content: string
  createdAt: string
  userId: string
  user?: { id: string; name: string; email: string; avatarUrl?: string | null }
}

export type ChannelMessagesPage = {
  messages: ChannelMessage[]
  hasMore: boolean
}

export function useEventMessages(eventId: string) {
  return useInfiniteQuery({
    queryKey: ['messages', 'event', eventId],
    queryFn: ({ pageParam }) =>
      apiFetch<EventMessagesPage>(
        `/events/${eventId}/messages?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: !!eventId,
  })
}

export function useChannelMessages(groupId: string, channelId: string) {
  return useInfiniteQuery({
    queryKey: ['messages', 'channel', channelId],
    queryFn: ({ pageParam }) =>
      apiFetch<ChannelMessagesPage>(
        `/groups/${groupId}/channels/${channelId}/messages?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.messages[0]?.id : undefined),
    initialPageParam: undefined as string | undefined,
    enabled: !!groupId && !!channelId,
  })
}

export function usePinMessage(eventId: string, messageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch(`/events/${eventId}/messages/${messageId}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: true }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', 'event', eventId] }),
  })
}

export function useAddReaction(eventId: string, messageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (emoji: string) =>
      apiFetch(`/events/${eventId}/messages/${messageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', 'event', eventId] }),
  })
}

export function useRemoveReaction(eventId: string, messageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (emoji: string) =>
      apiFetch(`/events/${eventId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', 'event', eventId] }),
  })
}
