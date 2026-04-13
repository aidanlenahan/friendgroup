import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

export type GroupSummary = {
  id: string
  name: string
  description?: string | null
  avatarUrl?: string | null
  _count?: { memberships?: number }
}

type GroupsResponse = { groups: GroupSummary[] }
type GroupResponse = { group: GroupSummary }
type GroupMembersResponse = {
  members: Array<{
    userId: string
    name: string
    email: string
    avatarUrl?: string | null
    role: 'owner' | 'admin' | 'member'
  }>
}
type GroupTagsResponse = {
  tags: Array<{ id: string; name: string; color?: string | null }>
}
type GroupChannelsResponse = {
  channels: Array<{
    id: string
    name: string
    kind?: string
    subscriberCount?: number
    messageCount?: number
    isSubscribed?: boolean
  }>
}

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => apiFetch<GroupsResponse>('/groups'),
  })
}

export function useGroup(groupId: string) {
  return useQuery({
    queryKey: ['groups', groupId],
    queryFn: () => apiFetch<GroupResponse>(`/groups/${groupId}`),
  })
}

export function useGroupMembers(groupId: string) {
  return useQuery({
    queryKey: ['groups', groupId, 'members'],
    queryFn: () => apiFetch<GroupMembersResponse>(`/groups/${groupId}/members`),
  })
}

export function useGroupTags(groupId: string) {
  return useQuery({
    queryKey: ['groups', groupId, 'tags'],
    queryFn: () => apiFetch<GroupTagsResponse>(`/groups/${groupId}/tags`),
  })
}

export function useGroupChannels(groupId: string) {
  return useQuery({
    queryKey: ['groups', groupId, 'channels'],
    queryFn: () => apiFetch<GroupChannelsResponse>(`/groups/${groupId}/channels`),
  })
}

export function useCreateGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      apiFetch('/groups', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })
}
