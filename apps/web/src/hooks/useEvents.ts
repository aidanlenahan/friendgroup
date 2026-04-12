import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

export function useEvents(groupId: string, params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams({ groupId, ...params }).toString()
  return useQuery({
    queryKey: ['events', groupId, params],
    queryFn: () => apiFetch<any>(`/events?${qs}`),
    enabled: !!groupId,
  })
}

export function useEvent(eventId: string) {
  return useQuery({
    queryKey: ['events', 'detail', eventId],
    queryFn: () => apiFetch<any>(`/events/${eventId}`),
    enabled: !!eventId,
  })
}

export function useEventAttendance(eventId: string) {
  return useQuery({
    queryKey: ['events', eventId, 'attendance'],
    queryFn: () => apiFetch<any>(`/events/${eventId}/attendance`),
    enabled: !!eventId,
  })
}

export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch<any>('/events', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
}

export function useUpdateEvent(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch<any>(`/events/${eventId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
}

export function useDeleteEvent(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
}

export function useRsvp(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (status: 'yes' | 'no' | 'maybe') =>
      apiFetch(`/events/${eventId}/rsvps`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['events', eventId, 'attendance'] })
    },
  })
}

export function useEventRating(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { rating?: number; isLegendary?: boolean }) =>
      apiFetch(`/events/${eventId}/rating`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
}

export function useEventMedia(eventId: string) {
  return useQuery({
    queryKey: ['events', eventId, 'media'],
    queryFn: () => apiFetch<any>(`/events/${eventId}/media`),
    enabled: !!eventId,
  })
}
