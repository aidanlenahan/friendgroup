import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

export type EventTemplateTag = { id: string; name: string; color?: string | null }

export type EventTemplate = {
  id: string
  groupId: string
  name: string
  title: string
  details?: string | null
  durationMinutes?: number | null
  location?: string | null
  maxAttendees?: number | null
  isPrivate: boolean
  createdAt: string
  updatedAt: string
  createdBy: { id: string; name: string; avatarUrl?: string | null } | null
  tags: EventTemplateTag[]
  isCreator: boolean
  isAdmin: boolean
}

type TemplatesResponse = { templates: EventTemplate[] }
type TemplateResponse = { template: EventTemplate }

export function useGroupEventTemplates(groupId: string) {
  return useQuery<TemplatesResponse>({
    queryKey: ['groups', groupId, 'event-templates'],
    queryFn: () => apiFetch<TemplatesResponse>(`/groups/${groupId}/event-templates`),
    enabled: !!groupId,
  })
}

export type CreateTemplateInput = {
  groupId: string
  name: string
  title: string
  details?: string
  durationMinutes?: number
  location?: string
  maxAttendees?: number
  isPrivate?: boolean
  tagIds?: string[]
}

export function useCreateEventTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, ...body }: CreateTemplateInput) =>
      apiFetch<TemplateResponse>(`/groups/${groupId}/event-templates`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['groups', vars.groupId, 'event-templates'] })
    },
  })
}

export type UpdateTemplateInput = {
  templateId: string
  groupId: string
  name?: string
  title?: string
  details?: string | null
  durationMinutes?: number | null
  location?: string | null
  maxAttendees?: number | null
  isPrivate?: boolean
  tagIds?: string[]
}

export function useUpdateEventTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, groupId: _g, ...body }: UpdateTemplateInput) =>
      apiFetch<TemplateResponse>(`/event-templates/${templateId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['groups', vars.groupId, 'event-templates'] })
    },
  })
}

export function useDeleteEventTemplate(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (templateId: string) =>
      apiFetch(`/event-templates/${templateId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'event-templates'] })
    },
  })
}
