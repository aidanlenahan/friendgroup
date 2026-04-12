import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

export function useEventMessages(eventId: string) {
  return useInfiniteQuery({
    queryKey: ['messages', 'event', eventId],
    queryFn: ({ pageParam }) =>
      apiFetch<any>(
        `/events/${eventId}/messages?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage: any) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!eventId,
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
