import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getApiErrorMessage } from '../lib/api'
import { useToast } from './useToast'

export type GroupSummary = {
  id: string
  name: string
  description?: string | null
  avatarUrl?: string | null
  statsEnabled?: boolean
  _count?: { memberships?: number }
}

type GroupsResponse = { groups: GroupSummary[] }
type GroupResponse = { group: GroupSummary }
type GroupMembersResponse = {
  members: Array<{
    userId: string
    name: string
    username?: string | null
    email?: string | null
    avatarUrl?: string | null
    role: 'owner' | 'admin' | 'member'
    status: 'active' | 'pending'
    mutedUntil?: string | null
  }>
}
type GroupTagsResponse = {
  tags: Array<{ id: string; name: string; color?: string | null }>
}
export type ChannelTag = { id: string; name: string; color?: string | null }

export type ChannelSummary = {
  id: string
  name: string
  isGeneral?: boolean
  isInviteOnly?: boolean
  subscriberCount?: number
  messageCount?: number
  isSubscribed?: boolean
  tags?: ChannelTag[]
  unreadCount?: number
}

type GroupChannelsResponse = {
  channels: ChannelSummary[]
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

export function useGroupMembers(groupId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['groups', groupId, 'members'],
    queryFn: () => apiFetch<GroupMembersResponse>(`/groups/${groupId}/members`),
    enabled: opts?.enabled ?? !!groupId,
  })
}

export function useGroupTags(groupId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['groups', groupId, 'tags'],
    queryFn: () => apiFetch<GroupTagsResponse>(`/groups/${groupId}/tags`),
    enabled: opts?.enabled ?? !!groupId,
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
  const toast = useToast()
  return useMutation({
    mutationFn: (data: { name: string; description?: string; betaCode?: string }) =>
      apiFetch('/groups', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to create group')),
  })
}

export function useSubscribeGroupChannel(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (channelId: string) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/subscribe`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to subscribe to channel')),
  })
}

export function useUnsubscribeGroupChannel(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (channelId: string) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/subscribe`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to unsubscribe from channel')),
  })
}

export function useCreateChannel(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (data: { name: string; isInviteOnly?: boolean }) =>
      apiFetch(`/groups/${groupId}/channels`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to create channel')),
  })
}

export function useUpdateMemberRole(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'member' }) =>
      apiFetch(`/groups/${groupId}/members/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update member role')),
  })
}

export function useRemoveMember(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to remove member')),
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
  const toast = useToast()
  return useMutation({
    mutationFn: () =>
      apiFetch<GroupInviteResponse>(`/groups/${groupId}/invite-code/regenerate`, { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(['groups', groupId, 'invite-code'], data),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to regenerate invite code')),
  })
}

export function useJoinGroup() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (inviteCode: string) =>
      apiFetch<{ message: string; groupId: string; groupName: string }>('/groups/join', {
        method: 'POST',
        body: JSON.stringify({ inviteCode }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to join group')),
  })
}

export function useApproveMember(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/groups/${groupId}/members/${userId}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to approve member')),
  })
}

export function useDenyMember(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/groups/${groupId}/members/${userId}/deny`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to deny member')),
  })
}

export function useUpdateGroup(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (data: { name?: string; description?: string; avatarUrl?: string | null; statsEnabled?: boolean }) =>
      apiFetch(`/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups', groupId] })
      qc.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update group')),
  })
}

export function useLeaveGroup(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => apiFetch(`/groups/${groupId}/leave`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to leave group')),
  })
}

export function useDeleteGroup(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => apiFetch(`/groups/${groupId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to delete group')),
  })
}

export function useCreateTag(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (data: { name: string; color?: string }) =>
      apiFetch(`/groups/${groupId}/tags`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'tags'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to create tag')),
  })
}

export function useDeleteTag(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (tagId: string) =>
      apiFetch(`/groups/${groupId}/tags/${tagId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'tags'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to delete tag')),
  })
}

export function useMuteMember(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ userId, durationHours }: { userId: string; durationHours?: number }) =>
      apiFetch(`/groups/${groupId}/members/${userId}/mute`, {
        method: 'POST',
        body: JSON.stringify(durationHours !== undefined ? { durationHours } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to mute member')),
  })
}

export function useUnmuteMember(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/groups/${groupId}/members/${userId}/unmute`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'members'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to unmute member')),
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
  const toast = useToast()
  return useMutation({
    mutationFn: ({ tagId, name, color }: { tagId: string; name?: string; color?: string }) =>
      apiFetch(`/groups/${groupId}/tags/${tagId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, color }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'tags'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update tag')),
  })
}

export type CalendarPreferences = {
  filterMode: 'all' | 'rsvp' | 'tags'
  tagIds: string[]
  feedUrl: string
}

export function useCalendarPreferences(groupId: string) {
  return useQuery({
    queryKey: ['groups', groupId, 'calendar-preferences'],
    queryFn: () => apiFetch<CalendarPreferences>(`/groups/${groupId}/calendar/preferences`),
    enabled: !!groupId,
  })
}

export function useUpdateCalendarPreferences(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (data: { filterMode: 'all' | 'rsvp' | 'tags'; tagIds?: string[] }) =>
      apiFetch<CalendarPreferences>(`/groups/${groupId}/calendar/preferences`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['groups', groupId, 'calendar-preferences'], data)
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'calendar-preferences'] })
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update calendar preferences')),
  })
}

export function useUpdateChannelTags(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ channelId, tagIds }: { channelId: string; tagIds: string[] }) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tagIds }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update channel tags')),
  })
}

export function useRenameChannel(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ channelId, name }: { channelId: string; name: string }) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to rename channel')),
  })
}

export function useDeleteChannel(groupId: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (channelId: string) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to delete channel')),
  })
}

export function useMarkChannelRead(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (channelId: string) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels'] }),
    // Silent — mark-read is a background operation; errors don't need to interrupt the user.
  })
}

export function useDeleteMessage(groupId: string, channelId: string) {
  const toast = useToast()
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to delete message')),
  })
}

export function useEditMessage(groupId: string, channelId: string) {
  return useMutation({
    mutationFn: ({ messageId, content }: { messageId: string; content: string }) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      }),
  })
}

export function usePinMessage(groupId: string, channelId: string) {
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/messages/${messageId}/pin`, { method: 'POST' }),
  })
}

export function useToggleReaction(groupId: string, channelId: string) {
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/messages/${messageId}/react`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      }),
  })
}

type ChannelSubscriber = { id: string; name: string; email: string; avatarUrl?: string | null }

export function useChannelSubscribers(groupId: string, channelId: string | undefined) {
  return useQuery({
    queryKey: ['groups', groupId, 'channels', channelId, 'subscribers'],
    queryFn: () =>
      apiFetch<{ subscribers: ChannelSubscriber[] }>(
        `/groups/${groupId}/channels/${channelId}/subscribers`,
      ),
    enabled: !!groupId && !!channelId,
  })
}

export function useAddChannelSubscriber(groupId: string, channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/subscribers/${userId}`, { method: 'PUT' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels', channelId, 'subscribers'] }),
  })
}

export function useRemoveChannelSubscriber(groupId: string, channelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/groups/${groupId}/channels/${channelId}/subscribers/${userId}`, { method: 'DELETE' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'channels', channelId, 'subscribers'] }),
  })
}

// ============================================================================
// Group Media Hooks
// ============================================================================

export type GroupMediaAsset = {
  id: string
  url: string
  filename: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  exifData: Record<string, unknown> | null
  caption: string | null
  createdAt: string
  uploaderId: string | null
  uploader: { id: string; name: string; avatarUrl: string | null } | null
  event: { id: string; title: string }
}

export type MediaAlbum = {
  id: string
  groupId: string
  name: string
  description: string | null
  createdById: string | null
  coverAssetId: string | null
  coverAsset: { id: string; url: string } | null
  photoCount: number
  createdAt: string
}

export type GroupMediaSettings = {
  enabled: boolean
  nonAdminEnabled: boolean
  storageLimitBytes: number
  usedBytes: number
}

export type GroupMediaResponse = {
  media: GroupMediaAsset[]
  settings: GroupMediaSettings
}

export function useGroupMedia(groupId: string) {
  return useQuery({
    queryKey: ['groups', groupId, 'media'],
    queryFn: () => apiFetch<GroupMediaResponse>(`/groups/${groupId}/media`),
    enabled: !!groupId,
  })
}

export function useDeleteGroupMediaAsset(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assetId: string) =>
      apiFetch(`/groups/${groupId}/media/${assetId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'media'] })
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'photos'] })
    },
  })
}

export type GroupMediaSettingsUpdate = {
  mediaUploadEnabled?: boolean
  mediaStorageLimitBytes?: number
  mediaUploadNonAdminEnabled?: boolean
  unlockCode?: string
}

export function useUpdateGroupMediaSettings(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: GroupMediaSettingsUpdate) =>
      apiFetch<{ mediaUploadEnabled: boolean; mediaStorageLimitBytes: number; mediaUploadNonAdminEnabled: boolean }>(
        `/groups/${groupId}/media-settings`,
        { method: 'PATCH', body: JSON.stringify(body) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'media'] }),
  })
}

type GroupPhotosResponse = { media: GroupMediaAsset[]; nextCursor: string | null }

export function useGroupPhotos(groupId: string) {
  return useQuery({
    queryKey: ['groups', groupId, 'photos'],
    queryFn: () => apiFetch<GroupPhotosResponse>(`/groups/${groupId}/photos`),
    enabled: !!groupId,
  })
}

export function useGroupPhotosInfinite(groupId: string) {
  return useInfiniteQuery({
    queryKey: ['groups', groupId, 'photos', 'infinite'],
    queryFn: ({ pageParam }) =>
      apiFetch<GroupPhotosResponse>(
        `/groups/${groupId}/photos${pageParam ? `?cursor=${pageParam}` : ''}`
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!groupId,
  })
}

// ─── Albums ──────────────────────────────────────────────────────────────────

export function useGroupAlbums(groupId: string) {
  return useQuery({
    queryKey: ['groups', groupId, 'albums'],
    queryFn: () => apiFetch<{ albums: MediaAlbum[] }>(`/groups/${groupId}/albums`),
    enabled: !!groupId,
  })
}

export function useAlbumPhotos(groupId: string, albumId: string | null) {
  return useQuery({
    queryKey: ['groups', groupId, 'albums', albumId, 'photos'],
    queryFn: () => apiFetch<{ media: GroupMediaAsset[] }>(`/groups/${groupId}/albums/${albumId}/photos`),
    enabled: !!groupId && !!albumId,
  })
}

export function useCreateAlbum(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      apiFetch<{ album: MediaAlbum }>(`/groups/${groupId}/albums`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'albums'] }),
  })
}

export function useUpdateAlbum(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ albumId, ...body }: { albumId: string; name?: string; description?: string | null; coverAssetId?: string | null }) =>
      apiFetch<{ album: MediaAlbum }>(`/groups/${groupId}/albums/${albumId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'albums'] }),
  })
}

export function useDeleteAlbum(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (albumId: string) =>
      apiFetch(`/groups/${groupId}/albums/${albumId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups', groupId, 'albums'] }),
  })
}

export function useAddToAlbum(groupId: string, albumId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assetId: string) =>
      apiFetch(`/groups/${groupId}/albums/${albumId}/assets`, { method: 'POST', body: JSON.stringify({ assetId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'albums', albumId, 'photos'] })
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'albums'] })
    },
  })
}

export function useRemoveFromAlbum(groupId: string, albumId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assetId: string) =>
      apiFetch(`/groups/${groupId}/albums/${albumId}/assets/${assetId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'albums', albumId, 'photos'] })
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'albums'] })
    },
  })
}
