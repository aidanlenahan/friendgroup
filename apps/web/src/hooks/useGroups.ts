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
    username?: string | null
    email: string
    avatarUrl?: string | null
    role: 'owner' | 'admin' | 'member'
    status: 'active' | 'pending'
    mutedUntil?: string | null
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
    isInviteOnly?: boolean
    subscriberCount?: number
    messageCount?: number
    isSubscribed?: boolean
  }>
}

export type GroupInviteResponse = {
  groupId: string
  inviteCode: string
  inviteUrl: string
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
    mutationFn: (data: { name: string; description?: string; betaCode?: string }) =>
      apiFetch('/groups', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })
}

export function useSubscribeGroupChannel(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (channelId: string) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/subscribe`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels'] })
    },
  })
}

export function useUnsubscribeGroupChannel(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (channelId: string) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/subscribe`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels'] })
    },
  })
}

export function useCreateChannel(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; isInviteOnly?: boolean }) =>
      apiFetch(`/groups/${groupId}/channels`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels'] })
    },
  })
}

export function useUpdateMemberRole(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'member' }) =>
      apiFetch(`/groups/${groupId}/members/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
  })
}

export function useRemoveMember(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
  })
}

export function useGroupInviteCode(groupId: string) {
  return useQuery({
    queryKey: ['groups', groupId, 'invite-code'],
    queryFn: () => apiFetch<GroupInviteResponse>(`/groups/${groupId}/invite-code`),
    enabled: false, // fetched on demand via refetch()
    retry: false,
  })
}

export function useRegenerateInviteCode(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<GroupInviteResponse>(`/groups/${groupId}/invite-code/regenerate`, { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(['groups', groupId, 'invite-code'], data),
  })
}

export function useJoinGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (inviteCode: string) =>
      apiFetch<{ message: string; groupId: string; groupName: string }>('/groups/join', {
        method: 'POST',
        body: JSON.stringify({ inviteCode }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })
}

export function useApproveMember(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/groups/${groupId}/members/${userId}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
  })
}

export function useDenyMember(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/groups/${groupId}/members/${userId}/deny`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
  })
}

export function useUpdateGroup(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name?: string; description?: string; avatarUrl?: string | null }) =>
      apiFetch(`/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups', groupId] })
      qc.invalidateQueries({ queryKey: ['groups'] })
    },
  })
}

export function useDeleteGroup(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/groups/${groupId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })
}

export function useCreateTag(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; color?: string }) =>
      apiFetch(`/groups/${groupId}/tags`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'tags'] }),
  })
}

export function useDeleteTag(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tagId: string) =>
      apiFetch(`/groups/${groupId}/tags/${tagId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'tags'] }),
  })
}

export function useMuteMember(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, durationHours }: { userId: string; durationHours?: number }) =>
      apiFetch(`/groups/${groupId}/members/${userId}/mute`, {
        method: 'POST',
        body: JSON.stringify(durationHours !== undefined ? { durationHours } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
  })
}

export function useUnmuteMember(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/groups/${groupId}/members/${userId}/unmute`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
  })
}

/**
 * useUpdateTag — PATCH /groups/:groupId/tags/:tagId
 *
 * Allows owners/admins to update a tag's name or color.
 * Invalidates the group's tags query on success so the UI reflects
 * the change immediately.
 */
export function useUpdateTag(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tagId, name, color }: { tagId: string; name?: string; color?: string }) =>
      apiFetch(`/groups/${groupId}/tags/${tagId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, color }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'tags'] }),
  })
}
