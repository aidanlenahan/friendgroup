import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

export type EventTag = { id: string; name: string; color?: string | null }

export type EventRecord = {
  id: string
  groupId: string
  title: string
  details?: string | null
  dateTime: string
  endsAt?: string | null
  location?: string | null
  isLegendary?: boolean
  avgRating?: number | null
  myRating?: number | null
  ratingCount?: number
  tags?: EventTag[]
}

type EventsResponse = { events: EventRecord[] }
type EventResponse = { event: EventRecord; isAdmin?: boolean; isCreator?: boolean }
type AttendanceResponse = {
  counts: { yes: number; no: number; maybe: number }
  attendees: Array<{
    status: 'yes' | 'no' | 'maybe'
    user: { id: string; name: string; avatarUrl?: string | null }
  }>
}
type EventMediaResponse = {
  media: Array<{
    id: string
    url: string
    filename: string
    mimeType: string
    sizeBytes: number
    likeCount: number
    likedByMe: boolean
  }>
}
type CreateEventInput = {
  groupId: string
  title: string
  dateTime: string
  details?: string
  location?: string
  endsAt?: string
  maxAttendees?: number
  isPrivate?: boolean
  tagIds?: string[]
}
type UpdateEventInput = Partial<Omit<CreateEventInput, 'groupId'>>

export function useEvents(groupId: string, params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams({ groupId, ...params }).toString()
  return useQuery({
    queryKey: ['events', groupId, params],
    queryFn: () => apiFetch<EventsResponse>(`/events?${qs}`),
    enabled: !!groupId,
  })
}

export function useEvent(eventId: string) {
  return useQuery({
    queryKey: ['events', 'detail', eventId],
    queryFn: () => apiFetch<EventResponse>(`/events/${eventId}`),
    enabled: !!eventId,
  })
}

export function useEventAttendance(eventId: string) {
  return useQuery({
    queryKey: ['events', eventId, 'attendance'],
    queryFn: () => apiFetch<AttendanceResponse>(`/events/${eventId}/attendance`),
    enabled: !!eventId,
  })
}

export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateEventInput) =>
      apiFetch<EventResponse>('/events', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
}

export function useUpdateEvent(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateEventInput) =>
      apiFetch<EventResponse>(`/events/${eventId}`, { method: 'PATCH', body: JSON.stringify(data) }),
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
    mutationFn: (value: number) =>
      apiFetch(`/events/${eventId}/ratings`, { method: 'POST', body: JSON.stringify({ value }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
}

export function useSetEventTags(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tagIds: string[]) =>
      apiFetch(`/events/${eventId}/tags`, { method: 'PATCH', body: JSON.stringify({ tagIds }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
}

export function useEventMedia(eventId: string) {
  return useQuery({
    queryKey: ['events', eventId, 'media'],
    queryFn: () => apiFetch<EventMediaResponse>(`/events/${eventId}/media`),
    enabled: !!eventId,
  })
}

export function useLikeMedia(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assetId: string) =>
      apiFetch<{ liked: boolean }>(`/media/${assetId}/like`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', eventId, 'media'] }),
  })
}
