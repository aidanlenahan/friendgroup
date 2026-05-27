import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import PageToolbar from '../components/PageToolbar'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useGroup,
  useGroupMembers,
  useGroupChannels,
  useGroupTags,
  useSubscribeGroupChannel,
  useUnsubscribeGroupChannel,
  useUpdateMemberRole,
  useRemoveMember,
  useGroupInviteCode,
  useRegenerateInviteCode,
  useApproveMember,
  useDenyMember,
  useCalendarPreferences,
  useUpdateCalendarPreferences,
  useCreateChannel,
  useGroupPhotos,
  useGroupAlbums,
  useAlbumPhotos,
  useCreateAlbum,
  useDeleteAlbum,
  useRemoveFromAlbum,
  useDeleteGroupMediaAsset,
  useLeaveGroup,
} from '../hooks/useGroups'
import type { MediaAlbum } from '../hooks/useGroups'
import { MediaLightbox } from '../components/MediaLightbox'
import type { LightboxMedia } from '../components/MediaLightbox'
import { useEvents, useDeleteEvent } from '../hooks/useEvents'
import EventCard from '../components/EventCard'
import Avatar from '../components/Avatar'
import EmptyState from '../components/EmptyState'
import { EventCardSkeleton, PhotoGridSkeleton } from '../components/Skeleton'
import { getApiErrorMessage, ApiError, apiFetch } from '../lib/api'
import { useToast } from '../hooks/useToast'
import { useIsOnline } from '../hooks/useIsOnline'
import { useAuthStore } from '../stores/authStore'
import { useGroupPolls, useDeletePoll, useVote, useRemoveVote, type Poll } from '../hooks/usePolls'

type Tab = 'events' | 'polls' | 'members' | 'channels' | 'media'

type EventSummary = {
  id: string
  title: string
  details?: string | null
  dateTime: string
  endsAt?: string | null
  location?: string | null
  isPrivate?: boolean
  tags?: Array<{ id: string; name: string; color?: string | null }>
  rsvps?: Array<{ status: string }>
}

function RoleGlyph({ role }: { role: 'owner' | 'admin' | 'member' }) {
  if (role === 'owner') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-[1.35rem] w-[1.35rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 18h14l-1-9-4 3-2-5-2 5-4-3-1 9Z" />
      </svg>
    )
  }

  if (role === 'admin') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 6 6v5c0 4.5 2.4 7.7 6 10 3.6-2.3 6-5.5 6-10V6l-6-3Z" />
      </svg>
    )
  }

  return null
}

function AdminEventCard({ event, canDelete, layout }: { event: EventSummary; canDelete: boolean; layout?: 'grid' | 'list' }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const toast = useToast()
  const deleteEvent = useDeleteEvent(event.id)

  const handleDelete = async () => {
    try {
      await deleteEvent.mutateAsync()
      toast.success('Event deleted')
    } catch {
      toast.error('Failed to delete event')
    }
  }

  return (
    <div className="relative">
      <EventCard event={event} layout={layout} />
      {canDelete && (
        <div className="absolute top-2 right-2 flex gap-1">
          {confirmDelete ? (
            <>
              <button
                onClick={handleDelete}
                disabled={deleteEvent.isPending}
                className="text-xs px-2 py-1 rounded-lg bg-red-900 text-red-200 hover:bg-red-800 transition-colors disabled:opacity-50"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2 py-1 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={(e) => { e.preventDefault(); setConfirmDelete(true) }}
              className="text-xs px-2 py-1 rounded-lg bg-gray-900/80 border border-gray-700 text-red-400 hover:bg-red-900/30 transition-colors opacity-0 group-hover:opacity-100"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    return (tab === 'polls' ? 'polls' : 'events') as Tab
  })
  const [eventLayout, setEventLayout] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('gem:eventLayout') as 'grid' | 'list') ?? 'grid'
  })
  const [confirmRemoveMember, setConfirmRemoveMember] = useState<string | null>(null)
  const [memberActionMenuUserId, setMemberActionMenuUserId] = useState<string | null>(null)
  const [showPastEvents, setShowPastEvents] = useState(false)
  const [eventSearch, setEventSearch] = useState('')
  const [showInviteCode, setShowInviteCode] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [showCalendarModal, setShowCalendarModal] = useState(false)
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false)
  const [mediaLightboxIndex, setMediaLightboxIndex] = useState<number | null>(null)
  const [mediaSubTab, setMediaSubTab] = useState<'all' | 'albums'>('all')
  const [selectedAlbum, setSelectedAlbum] = useState<MediaAlbum | null>(null)
  const [showCreateAlbumModal, setShowCreateAlbumModal] = useState(false)
  const [confirmDeleteAlbumId, setConfirmDeleteAlbumId] = useState<string | null>(null)
  const [newAlbumName, setNewAlbumName] = useState('')
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelInviteOnly, setNewChannelInviteOnly] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [copiedFeedUrl, setCopiedFeedUrl] = useState(false)
  const [calendarFilterMode, setCalendarFilterMode] = useState<'all' | 'rsvp' | 'tags'>('all')
  const [calendarTagIds, setCalendarTagIds] = useState<string[]>([])
  const memberActionMenuRef = useRef<HTMLDivElement>(null)
  const tabScrollRef = useRef<HTMLDivElement>(null)
  const [tabCanScrollLeft, setTabCanScrollLeft] = useState(false)
  const [tabCanScrollRight, setTabCanScrollRight] = useState(false)
  const toast = useToast()
  const isOnline = useIsOnline()
  const currentUser = useAuthStore((s) => s.user)

  const {
    data: groupData,
    isLoading: groupLoading,
    isError: groupError,
    error: groupErrorDetails,
    refetch: refetchGroup,
  } = useGroup(groupId!)
  const { data: membersData } = useGroupMembers(groupId!)
  const { data: channelsData } = useGroupChannels(groupId!)
  const { data: eventsData, isLoading: eventsLoading } = useEvents(groupId!)
  const { data: pollsData } = useGroupPolls(groupId!)
  const deletePoll = useDeletePoll(groupId!)
  const castVote = useVote(groupId!)
  const removeVote = useRemoveVote(groupId!)
  const { data: photosData, isLoading: photosLoading } = useGroupPhotos(groupId!)
  const { data: albumsData, isLoading: albumsLoading } = useGroupAlbums(groupId!)
  const { data: albumPhotosData, isLoading: albumPhotosLoading } = useAlbumPhotos(groupId!, selectedAlbum?.id ?? null)
  const createAlbum = useCreateAlbum(groupId!)
  const deleteAlbum = useDeleteAlbum(groupId!)
  const removeFromAlbum = useRemoveFromAlbum(groupId!, selectedAlbum?.id ?? '')
  const deleteGroupMedia = useDeleteGroupMediaAsset(groupId!)
  const { data: inviteCodeData, refetch: refetchInviteCode } = useGroupInviteCode(groupId!)
  const subscribeChannel = useSubscribeGroupChannel(groupId!)
  const unsubscribeChannel = useUnsubscribeGroupChannel(groupId!)
  const createChannel = useCreateChannel(groupId!)
  const updateMemberRole = useUpdateMemberRole(groupId!)
  const removeMember = useRemoveMember(groupId!)
  const regenerateCode = useRegenerateInviteCode(groupId!)
  const approveMember = useApproveMember(groupId!)
  const denyMember = useDenyMember(groupId!)
  const leaveGroup = useLeaveGroup(groupId!)

  // Per-user mute
  const qc = useQueryClient()
  const { data: mutedData } = useQuery({
    queryKey: ['users', 'muted'],
    queryFn: () => apiFetch<{ mutedUsers: { id: string }[] }>('/users/muted'),
  })
  const mutedSet = new Set(mutedData?.mutedUsers.map((u) => u.id) ?? [])
  const muteUser = useMutation({
    mutationFn: (userId: string) =>
      apiFetch<{ muted: boolean }>(`/users/${userId}/mute`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', 'muted'] }),
    onError: () => toast.error('Failed to mute user'),
  })
  const unmuteUser = useMutation({
    mutationFn: (userId: string) =>
      apiFetch<{ muted: boolean }>(`/users/${userId}/mute`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users', 'muted'] }),
    onError: () => toast.error('Failed to unmute user'),
  })

  // Per-user calendar preferences
  const { data: calendarPrefs } = useCalendarPreferences(groupId!)
  const updateCalendarPrefs = useUpdateCalendarPreferences(groupId!)

  // Determine current user's role in this group
  const myMembership = membersData?.members?.find((m) => m.userId === currentUser?.id)
  const isOwner = myMembership?.role === 'owner'
  const isAdmin = isOwner || myMembership?.role === 'admin'

  const pendingMembers = membersData?.members?.filter((m) => m.status === 'pending') ?? []
  const activeMembers = membersData?.members?.filter((m) => m.status === 'active') ?? []

  const { data: groupTagsData } = useGroupTags(groupId!)
  const groupTags = groupTagsData?.tags ?? []

  // Sync server prefs into local state when modal opens
  const openCalendarModal = () => {
    setCalendarFilterMode((calendarPrefs?.filterMode as 'all' | 'rsvp' | 'tags') ?? 'all')
    setCalendarTagIds(calendarPrefs?.tagIds ?? [])
    setShowCalendarModal(true)
  }

  const handleSaveCalendarPrefs = async () => {
    try {
      await updateCalendarPrefs.mutateAsync({ filterMode: calendarFilterMode, tagIds: calendarTagIds })
      toast.success('Calendar settings saved')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to save calendar settings'))
    }
  }

  const handleChannelToggle = async (channelId: string, isSubscribed: boolean) => {
    try {
      if (isSubscribed) {
        await unsubscribeChannel.mutateAsync(channelId)
        toast.success('Channel unsubscribed')
      } else {
        await subscribeChannel.mutateAsync(channelId)
        toast.success('Channel subscribed')
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to update channel subscription'))
    }
  }

  const handleRoleToggle = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin'
    try {
      await updateMemberRole.mutateAsync({ userId, role: newRole })
      toast.success(`Member ${newRole === 'admin' ? 'promoted to admin' : 'demoted to member'}`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to update role'))
    }
  }

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMember.mutateAsync(userId)
      setConfirmRemoveMember(null)
      setMemberActionMenuUserId(null)
      toast.success('Member removed')
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to remove member'))
    }
  }

  const handleMuteToggle = (userId: string) => {
    setMemberActionMenuUserId(null)
    if (mutedSet.has(userId)) {
      unmuteUser.mutate(userId)
      return
    }
    muteUser.mutate(userId)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (memberActionMenuRef.current && !memberActionMenuRef.current.contains(event.target as Node)) {
        setMemberActionMenuUserId(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleShowInviteCode = () => {
    setShowInviteCode(true)
    refetchInviteCode()
  }

  const handleCopyCode = async () => {
    const code = inviteCodeData?.inviteCode
    if (!code) return
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code)
      } else {
        // Fallback for HTTP / non-secure contexts
        const el = document.createElement('textarea')
        el.value = code
        el.style.position = 'fixed'
        el.style.opacity = '0'
        document.body.appendChild(el)
        el.focus()
        el.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(el)
        if (!ok) throw new Error('execCommand failed')
      }
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } catch {
      toast.error('Failed to copy code')
    }
  }

  const handleCopyInviteLink = async () => {
    const inviteUrl = inviteCodeData?.inviteUrl ?? ''
    if (!inviteUrl) return
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(inviteUrl)
      } else {
        const el = document.createElement('textarea')
        el.value = inviteUrl
        el.style.position = 'fixed'
        el.style.opacity = '0'
        document.body.appendChild(el)
        el.focus()
        el.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(el)
        if (!ok) throw new Error('execCommand failed')
      }
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } catch {
      toast.error('Failed to copy invite link')
    }
  }

  const handleRegenerateCode = async () => {
    try {
      await regenerateCode.mutateAsync()
      await refetchInviteCode()
      toast.success('Invite code regenerated')
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to regenerate code'))
    }
  }

  const handleApprove = async (userId: string) => {
    try {
      await approveMember.mutateAsync(userId)
      toast.success('Member approved')
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to approve member'))
    }
  }

  const handleDeny = async (userId: string) => {
    try {
      await denyMember.mutateAsync(userId)
      toast.success('Request denied')
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to deny request'))
    }
  }

  const handleLeaveGroup = async () => {
    try {
      await leaveGroup.mutateAsync()
      navigate('/groups')
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to leave group'))
    }
  }

  useEffect(() => {
    if (!groupData?.group?.name) return
    document.title = `${groupData.group.name} — GEM`
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [groupData?.group?.name])

  useEffect(() => {
    const el = tabScrollRef.current
    if (!el) return
    const update = () => {
      setTabCanScrollLeft(el.scrollLeft > 0)
      setTabCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  if (groupLoading) {
    return (
      <div className="space-y-2 px-4 pt-4">
        {Array.from({ length: 3 }).map((_, i) => <EventCardSkeleton key={i} />)}
      </div>
    )
  }

  const group = groupData?.group

  if (groupError && !group) {
    return (
      <div className="flex flex-col items-center py-16 gap-3 text-gray-400">
        <p>{!isOnline ? 'You are offline and there is no cached data.' : (groupErrorDetails instanceof ApiError && groupErrorDetails.code === 'MEMBERSHIP_PENDING' ? groupErrorDetails.message : getApiErrorMessage(groupErrorDetails, 'Failed to load group.'))}</p>
        {isOnline && (
          <button
            onClick={() => refetchGroup()}
            className="px-4 py-2 rounded-xl bg-gray-800 text-gray-200 text-sm hover:bg-gray-700 transition-colors"
          >
            Try again
          </button>
        )}
      </div>
    )
  }

  if (!group) {
    return (
      <EmptyState title="Group not found" description="This group does not exist or you don't have access." />
    )
  }

  const photoCount = photosData?.media?.length ?? 0
  const pollCount = pollsData?.polls.length ?? 0
  const tabs: { key: Tab; label: string }[] = [
    { key: 'events', label: 'Events' },
    { key: 'polls', label: pollCount > 0 ? `Polls (${pollCount})` : 'Polls' },
    { key: 'members', label: `Members (${group._count?.memberships ?? 0})` },
    { key: 'channels', label: 'Channels' },
    { key: 'media', label: photoCount > 0 ? `Photos (${photoCount})` : 'Photos' },
  ]

  const lightboxMedia: LightboxMedia[] = (photosData?.media ?? []).map((m) => ({
    id: m.id, url: m.url, filename: m.filename, sizeBytes: m.sizeBytes,
    mimeType: m.mimeType, width: m.width, height: m.height, exifData: m.exifData,
    caption: m.caption ?? null, createdAt: m.createdAt, uploader: m.uploader,
  }))

  const albumLightboxMedia: LightboxMedia[] = (albumPhotosData?.media ?? []).map((m) => ({
    id: m.id, url: m.url, filename: m.filename, sizeBytes: m.sizeBytes,
    mimeType: m.mimeType, width: m.width, height: m.height, exifData: m.exifData,
    caption: m.caption ?? null, createdAt: m.createdAt, uploader: m.uploader,
  }))

  const groupQc = useQueryClient()

  const handleSaveCaptionGroup = async (assetId: string, caption: string | null) => {
    await apiFetch(`/media/${assetId}/caption`, { method: 'PATCH', body: JSON.stringify({ caption }) })
    groupQc.invalidateQueries({ queryKey: ['groups', groupId, 'photos'] })
    if (selectedAlbum) groupQc.invalidateQueries({ queryKey: ['groups', groupId, 'albums', selectedAlbum.id, 'photos'] })
  }

  const handleCreateAlbum = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newAlbumName.trim()
    if (!name) return
    try {
      await createAlbum.mutateAsync({ name })
      setNewAlbumName('')
      setShowCreateAlbumModal(false)
      toast.success('Album created')
    } catch {
      toast.error('Failed to create album')
    }
  }

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newChannelName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (!name) return
    try {
      await createChannel.mutateAsync({ name, isInviteOnly: newChannelInviteOnly })
      toast.success(`#${name} created`)
      setShowCreateChannelModal(false)
      setNewChannelName('')
      setNewChannelInviteOnly(false)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to create channel'))
    }
  }

  return (
    <div className="w-full min-w-0 px-4 py-6 sm:p-6 max-w-5xl mx-auto">
      {groupError && !isOnline && (
        <div className="mb-4 px-4 py-2 rounded-xl bg-yellow-900/40 border border-yellow-700 text-yellow-300 text-sm">
          You are offline. Showing cached data.
        </div>
      )}
      {/* Group Header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">{group.name}</h2>
          {group.description && <p className="text-gray-400 mt-1">{group.description}</p>}
          <button
            onClick={() => setActiveTab('members')}
            className="text-gray-500 text-sm mt-1 hover:text-gray-300 transition-colors"
          >
            {group._count?.memberships ?? 0} members
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(isAdmin || group.statsEnabled) && (
            <Link
              to={`/groups/${groupId}/stats`}
              title="Stats"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:border-indigo-600 hover:text-white text-xs font-medium transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="hidden sm:inline">Stats</span>
            </Link>
          )}
          {isAdmin && (
            <Link
              to={`/groups/${groupId}/manage`}
              title="Manage group"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:border-indigo-600 hover:text-white text-xs font-medium transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden sm:inline">Manage</span>
            </Link>
          )}
          <PageToolbar backTo="/groups" />
        </div>
      </div>

      {/* Tab Bar */}
      <div className="relative mb-6">
        {tabCanScrollLeft && (
          <div className="absolute left-0 top-0 bottom-[1px] w-10 bg-gradient-to-r from-gray-950 to-transparent pointer-events-none z-10 flex items-center">
            <svg className="w-3.5 h-3.5 text-gray-500 ml-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </div>
        )}
        {tabCanScrollRight && (
          <div className="absolute right-0 top-0 bottom-[1px] w-10 bg-gradient-to-l from-gray-950 to-transparent pointer-events-none z-10 flex items-center justify-end">
            <svg className="w-3.5 h-3.5 text-gray-500 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        )}
        <div ref={tabScrollRef} className="flex gap-1 border-b border-gray-800 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-shrink-0 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-indigo-400 border-b-2 border-indigo-400'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Events Tab */}
      {activeTab === 'events' && (() => {
        const now = new Date()
        const q = eventSearch.trim().toLowerCase()
        const filterEvent = (e: EventSummary) => {
          if (!q) return true
          const dateStr = new Date(e.dateTime).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toLowerCase()
          return (
            e.title.toLowerCase().includes(q) ||
            (e.details?.toLowerCase().includes(q) ?? false) ||
            dateStr.includes(q) ||
            (e.tags?.some((t) => t.name.toLowerCase().includes(q)) ?? false)
          )
        }
        const upcomingEvents = (eventsData?.events ?? []).filter((e) =>
          (e.endsAt ? new Date(e.endsAt) > now : new Date(e.dateTime) > now) && filterEvent(e)
        )
        const pastEvents = (eventsData?.events ?? []).filter((e) =>
          (e.endsAt ? new Date(e.endsAt) <= now : new Date(e.dateTime) <= now) && filterEvent(e)
        )
        return (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1">
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="search"
                value={eventSearch}
                onChange={(e) => setEventSearch(e.target.value)}
                placeholder="Search by name, tag, date…"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-900 border border-gray-700 text-gray-200 placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
            <Link
              to={`/groups/${groupId}/events/new`}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap"
            >
              +<span className="hidden sm:inline"> Create Event</span>
            </Link>
            {/* View toggle */}
            <div className="flex items-center rounded-xl border border-gray-700 overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => { setEventLayout('grid'); localStorage.setItem('gem:eventLayout', 'grid') }}
                title="Grid view"
                aria-label="Grid view"
                aria-pressed={eventLayout === 'grid'}
                className={`h-9 w-9 flex items-center justify-center transition-colors ${eventLayout === 'grid' ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => { setEventLayout('list'); localStorage.setItem('gem:eventLayout', 'list') }}
                title="List view"
                aria-label="List view"
                aria-pressed={eventLayout === 'list'}
                className={`h-9 w-9 flex items-center justify-center transition-colors ${eventLayout === 'list' ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              onClick={() => openCalendarModal()}
              title="Subscribe to calendar"
              aria-label="Subscribe to calendar"
              className="h-9 w-9 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </button>
          </div>
          {eventsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <EventCardSkeleton key={i} />)}
            </div>
          ) : !eventsData?.events?.length ? (
            <EmptyState
              icon={
                <svg className="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="8" y="12" width="48" height="44" rx="5"/>
                  <line x1="8" y1="26" x2="56" y2="26"/>
                  <line x1="20" y1="6" x2="20" y2="18"/>
                  <line x1="44" y1="6" x2="44" y2="18"/>
                  <circle cx="22" cy="37" r="2" fill="currentColor" stroke="none"/>
                  <circle cx="32" cy="37" r="2" fill="currentColor" stroke="none"/>
                  <circle cx="42" cy="37" r="2" fill="currentColor" stroke="none"/>
                  <circle cx="22" cy="47" r="2" fill="currentColor" stroke="none"/>
                  <circle cx="32" cy="47" r="2" fill="currentColor" stroke="none"/>
                </svg>
              }
              title="No events yet"
              description="Create the first event for this group."
              action={
                <Link
                  to={`/groups/${groupId}/events/new`}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold"
                >
                  Create Event
                </Link>
              }
            />
          ) : (
            <>
              {upcomingEvents.length > 0 ? (
                <div className={eventLayout === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'flex flex-col gap-1.5'}>
                  {upcomingEvents.map((event) => (
                    <AdminEventCard
                      key={event.id}
                      event={event}
                      canDelete={isAdmin}
                      layout={eventLayout}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm mb-4">No upcoming events.</p>
              )}
              {pastEvents.length > 0 && (
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => setShowPastEvents((s) => !s)}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors mb-3"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className={`h-4 w-4 transition-transform ${showPastEvents ? 'rotate-180' : ''}`}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                    </svg>
                    Past Events ({pastEvents.length})
                  </button>
                  {showPastEvents && (
                    <div className={`opacity-60 ${eventLayout === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'flex flex-col gap-1.5'}`}>
                      {pastEvents.map((event) => (
                        <AdminEventCard
                          key={event.id}
                          event={event}
                          canDelete={isAdmin}
                          layout={eventLayout}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        )
      })()}

      {/* Polls Tab */}
      {activeTab === 'polls' && (
        <PollsTab
          groupId={groupId!}
          polls={pollsData?.polls ?? []}
          currentUserId={currentUser?.id ?? ''}
          onCreatePoll={() => navigate(`/groups/${groupId}/polls/new`)}
          onEditPoll={(poll) => navigate(`/groups/${groupId}/polls/new`, { state: { poll } })}
          onDeletePoll={async (pollId) => {
            try {
              await deletePoll.mutateAsync(pollId)
              toast.success('Poll deleted')
            } catch {
              toast.error('Failed to delete poll')
            }
          }}
          onVote={async (pollId, optionId, answer) => {
            try {
              await castVote.mutateAsync({ pollId, optionId, answer })
            } catch {
              toast.error('Failed to save vote')
            }
          }}
          onRemoveVote={async (pollId, optionId) => {
            try {
              await removeVote.mutateAsync({ pollId, optionId })
            } catch {
              toast.error('Failed to remove vote')
            }
          }}
        />
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          {/* Invite Users button + invite code panel — all members */}
          <div className="flex justify-end">
            <button
              onClick={handleShowInviteCode}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-900/50 border border-indigo-700 text-indigo-300 hover:bg-indigo-800/50 transition-colors font-medium"
            >
              Invite Users
            </button>
          </div>

          {/* Invite code panel — all members can view/copy; only admins can regen */}
          {showInviteCode && (
            <div className="bg-gray-900 rounded-xl border border-indigo-800 p-4 space-y-3">
              <p className="text-sm text-gray-400">Share this invite link to open the join flow directly. The same underlying group code still powers requests to join.</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={inviteCodeData?.inviteUrl ?? ''}
                  placeholder="Invite link will appear here"
                  className="flex-1 min-w-0 text-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 font-mono"
                />
                <button
                  onClick={handleCopyInviteLink}
                  disabled={!inviteCodeData?.inviteUrl}
                  className="px-3 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors text-sm disabled:opacity-50"
                >
                  {copiedCode ? 'Copied!' : 'Copy link'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-lg tracking-widest text-indigo-300 bg-gray-800 rounded-lg px-4 py-2 select-all">
                  {inviteCodeData?.inviteCode
                    ? inviteCodeData.inviteCode.match(/.{1,4}/g)?.join('-')
                    : '————————————'}
                </code>
                <button
                  onClick={handleCopyCode}
                  disabled={!inviteCodeData?.inviteCode}
                  className="px-3 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors text-sm disabled:opacity-50"
                >
                  Copy code
                </button>
              </div>
              <div className="flex items-center justify-between">
                {isAdmin && (
                  <button
                    onClick={handleRegenerateCode}
                    disabled={regenerateCode.isPending}
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    {regenerateCode.isPending ? 'Regenerating...' : 'Regenerate code (invalidates current)'}
                  </button>
                )}
                <button
                  onClick={() => setShowInviteCode(false)}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors ml-auto"
                >
                  Hide
                </button>
              </div>
            </div>
          )}

          {/* Pending join requests — owner/admin only */}
          {isAdmin && pendingMembers.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">
                Pending Requests ({pendingMembers.length})
              </h4>
              <div className="space-y-2">
                {pendingMembers.map((m) => (
                  <div
                    key={m.userId}
                    className="flex items-center gap-3 bg-amber-900/20 rounded-xl p-3 border border-amber-800/50"
                  >
                    <Avatar name={m.name} avatarUrl={m.avatarUrl} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{m.name}</p>
                      {m.username && (
                        <p className="text-xs text-indigo-400">@{m.username}</p>
                      )}
                      {m.email && <p className="text-xs text-gray-500">{m.email}</p>}
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-amber-900 text-amber-300">
                      pending
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleApprove(m.userId)}
                        disabled={approveMember.isPending}
                        className="text-xs px-2 py-1 rounded-lg bg-emerald-900 text-emerald-300 hover:bg-emerald-800 transition-colors disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleDeny(m.userId)}
                        disabled={denyMember.isPending}
                        className="text-xs px-2 py-1 rounded-lg bg-red-900 text-red-300 hover:bg-red-800 transition-colors disabled:opacity-50"
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active members */}
          {activeMembers.length > 0 && (
            <div className="space-y-2">
              {pendingMembers.length > 0 && isAdmin && (
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Active Members ({activeMembers.length})
                </h4>
              )}
              {activeMembers.map((m) => {
                const isSelf = m.userId === currentUser?.id
                const canOwnerManageMember = isOwner && !isSelf && m.role !== 'owner'
                return (
                <div
                  key={m.userId}
                  className="flex items-center gap-3 bg-gray-900 rounded-xl p-3 border border-gray-800"
                >
                  <Avatar name={m.name} avatarUrl={m.avatarUrl} size="sm" />
                  <div className="flex-1 min-w-0">
                    {isSelf ? (
                      <Link
                        to="/profile"
                        className="text-sm font-medium text-white hover:text-indigo-300 transition-colors truncate block"
                      >
                        {m.name}<span className="text-xs text-gray-500 ml-1">(you)</span>
                      </Link>
                    ) : m.username ? (
                      <Link
                        to={`/u/${m.username}`}
                        className="text-sm font-medium text-white hover:text-indigo-300 transition-colors truncate block"
                      >
                        {m.name}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-white truncate">{m.name}</p>
                    )}
                    {m.username && (
                      <p className="text-xs text-indigo-400">@{m.username}</p>
                    )}
                    {m.email && <p className="text-xs text-gray-500">{m.email}</p>}
                  </div>
                  {(m.role === 'owner' || m.role === 'admin') && (
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-amber-300"
                      title={m.role === 'owner' ? 'Owner' : 'Admin'}
                      aria-label={m.role === 'owner' ? 'Owner' : 'Admin'}
                    >
                      <RoleGlyph role={m.role} />
                    </span>
                  )}
                  {isSelf && !isOwner && (
                    confirmLeave ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleLeaveGroup}
                          disabled={leaveGroup.isPending}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-red-900/60 border border-red-700 text-red-300 hover:bg-red-900 transition-colors disabled:opacity-50"
                        >
                          {leaveGroup.isPending ? 'Leaving…' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => setConfirmLeave(false)}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        title="Leave group"
                        onClick={() => setConfirmLeave(true)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-red-500 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                      </button>
                    )
                  )}
                  {!isSelf && (
                    <div className="relative" ref={memberActionMenuUserId === m.userId ? memberActionMenuRef : null}>
                      <button
                        type="button"
                        aria-label={`Open member actions for ${m.name}`}
                        aria-expanded={memberActionMenuUserId === m.userId}
                        onClick={() => {
                          setConfirmRemoveMember((current) => (current === m.userId ? current : null))
                          setMemberActionMenuUserId((current) => current === m.userId ? null : m.userId)
                        }}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800 text-gray-300 transition-colors hover:bg-gray-700"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <circle cx="12" cy="5" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="12" cy="19" r="1.8" />
                        </svg>
                      </button>
                      {memberActionMenuUserId === m.userId && (
                        <div className="absolute right-0 top-11 z-20 min-w-[11rem] rounded-xl border border-gray-800 bg-gray-950 p-1.5 shadow-2xl shadow-black/40">
                          <button
                            type="button"
                            onClick={() => handleMuteToggle(m.userId)}
                            disabled={muteUser.isPending || unmuteUser.isPending}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-900 disabled:opacity-50"
                          >
                            {mutedSet.has(m.userId) ? (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.143 17.082a24.248 24.248 0 0 0 3.714 0M3 3l18 18M10.584 10.587a2 2 0 0 0 2.828 2.83M7.843 7.84A6.002 6.002 0 0 0 6 13v3l-1.256 1.148A1 1 0 0 0 5.5 19h13a1 1 0 0 0 .756-1.652l-.256-.234" />
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V5a2 2 0 1 0-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
                              </svg>
                            )}
                            <span>{mutedSet.has(m.userId) ? 'Unmute notifications' : 'Mute notifications'}</span>
                          </button>
                          {canOwnerManageMember && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setMemberActionMenuUserId(null)
                                  handleRoleToggle(m.userId, m.role)
                                }}
                                disabled={updateMemberRole.isPending}
                                className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-900 disabled:opacity-50"
                              >
                                {m.role === 'admin' ? (
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m0 0-5-5m5 5 5-5" />
                                  </svg>
                                ) : (
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0-5 5m5-5 5 5" />
                                  </svg>
                                )}
                                <span>{m.role === 'admin' ? 'Demote to member' : 'Promote to admin'}</span>
                              </button>
                              {confirmRemoveMember === m.userId ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveMember(m.userId)}
                                    disabled={removeMember.isPending}
                                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-950/50 disabled:opacity-50"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-7 4v6m4-6v6m-7 4h10a1 1 0 0 0 1-1V6H6v13a1 1 0 0 0 1 1Z" />
                                    </svg>
                                    <span>Confirm remove</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmRemoveMember(null)}
                                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-400 transition-colors hover:bg-gray-900"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmRemoveMember(m.userId)}
                                  className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-950/50"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-7 4v6m4-6v6m-7 4h10a1 1 0 0 0 1-1V6H6v13a1 1 0 0 0 1 1Z" />
                                  </svg>
                                  <span>Remove</span>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )})}
            </div>
          )}
        </div>
      )}

      {/* Channels Tab */}
      {activeTab === 'channels' && (() => {
        const sortedChannels = [...(channelsData?.channels ?? [])].sort(
          (a, b) => (b.isGeneral ? 1 : 0) - (a.isGeneral ? 1 : 0)
        )
        const firstChannel = sortedChannels[0]
        return (
        <div className="space-y-2">
          {isAdmin && (
            <div className="flex justify-end pb-1">
              <button
                onClick={() => setShowCreateChannelModal(true)}
                className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                <span className="text-base leading-none">+</span> New channel
              </button>
            </div>
          )}
          {!sortedChannels.length ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <EmptyState title="No channels" description={isAdmin ? 'Create the first channel for your group.' : 'Channels are for group discussions. Ask an admin to create one.'} />
              {isAdmin && (
                <button
                  onClick={() => setShowCreateChannelModal(true)}
                  className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  Create channel
                </button>
              )}
            </div>
          ) : (
            sortedChannels.map((ch) => (
              <div
                key={ch.id}
                className="flex items-center justify-between gap-3 bg-gray-900 rounded-xl p-3 border border-gray-800"
              >
                <Link
                  to={`/groups/${groupId}/channels/${ch.id}`}
                  className="min-w-0 flex-1 group"
                >
                  <p className="text-sm font-medium text-white truncate group-hover:text-indigo-300 transition-colors">
                    # {ch.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {ch.subscriberCount} subscribers · {ch.messageCount} messages · tap to chat
                  </p>
                </Link>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      ch.isInviteOnly
                        ? 'bg-amber-900 text-amber-300'
                        : 'bg-emerald-900 text-emerald-300'
                    }`}
                  >
                    {ch.isInviteOnly ? 'Invite-only' : 'Open'}
                  </span>
                  {!ch.isGeneral && (
                    <button
                      onClick={() => handleChannelToggle(ch.id, Boolean(ch.isSubscribed))}
                      disabled={subscribeChannel.isPending || unsubscribeChannel.isPending || Boolean(ch.isInviteOnly && !ch.isSubscribed)}
                      className={`text-xs px-2 py-1 rounded-full transition-colors disabled:opacity-50 ${
                        ch.isSubscribed
                          ? 'bg-indigo-900 text-indigo-300 hover:bg-indigo-800'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                      title={ch.isInviteOnly && !ch.isSubscribed ? 'This channel requires an invite to subscribe' : undefined}
                    >
                      {ch.isSubscribed ? 'Subscribed' : 'Subscribe'}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          {/* Open channel chat button — always visible if channels exist */}
          {firstChannel && (
            <div className="pt-2">
              <Link
                to={`/groups/${groupId}/channels/${firstChannel.id}`}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-indigo-900/40 border border-indigo-800/60 text-indigo-300 hover:bg-indigo-900/60 transition-colors text-sm font-medium"
              >
                Open #{firstChannel.name} →
              </Link>
            </div>
          )}
        </div>
        )
      })()}

      {/* Media Tab */}
      {activeTab === 'media' && (
        <div>
          {/* Gallery link */}
          <div className="flex justify-end mb-3">
            <Link
              to={`/groups/${groupId}/gallery`}
              className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              View full gallery
            </Link>
          </div>

          {/* All / Albums sub-tabs */}
          <div className="flex items-center gap-1 mb-3">
            {(['all', 'albums'] as const).map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => { setMediaSubTab(sub); setSelectedAlbum(null); setMediaLightboxIndex(null) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                  mediaSubTab === sub
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                {sub === 'all' ? 'All Photos' : 'Albums'}
              </button>
            ))}
            {isAdmin && mediaSubTab === 'albums' && !selectedAlbum && (
              <button
                type="button"
                onClick={() => setShowCreateAlbumModal(true)}
                className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
              >
                + New Album
              </button>
            )}
            {selectedAlbum && (
              <button
                type="button"
                onClick={() => { setSelectedAlbum(null); setMediaLightboxIndex(null) }}
                className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white transition-colors"
              >
                ← All Albums
              </button>
            )}
          </div>

          {/* All Photos grid */}
          {mediaSubTab === 'all' && (
            photosLoading ? (
              <PhotoGridSkeleton />
            ) : !photosData?.media?.length ? (
              <EmptyState title="No photos yet" description="Photos uploaded to events in this group will appear here." />
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 sm:gap-1.5">
                {photosData.media.map((photo, i) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setMediaLightboxIndex(i)}
                    className="group relative aspect-square overflow-hidden rounded-lg bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <img src={photo.url} alt={photo.filename} className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" loading="lazy" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                    <div className="absolute bottom-0 inset-x-0 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-white text-[10px] font-medium truncate leading-tight drop-shadow">{photo.event.title}</p>
                      <p className="text-white/70 text-[10px] truncate leading-tight drop-shadow">{photo.uploader?.name ?? 'Unknown'}</p>
                    </div>
                  </button>
                ))}
              </div>
            )
          )}

          {/* Albums grid */}
          {mediaSubTab === 'albums' && !selectedAlbum && (
            albumsLoading ? (
              <PhotoGridSkeleton count={6} />
            ) : !albumsData?.albums?.length ? (
              <EmptyState
                title="No albums yet"
                description={isAdmin ? 'Create an album to organise group photos.' : 'Admins can create albums to organise group photos.'}
              />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {albumsData.albums.map((album) => (
                  <div key={album.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => setSelectedAlbum(album)}
                      className="w-full text-left"
                    >
                      <div className="aspect-square bg-gray-800 rounded-xl overflow-hidden mb-2">
                        {album.coverAsset ? (
                          <img src={album.coverAsset.url} alt={album.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" decoding="async" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-600">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-200 truncate">{album.name}</p>
                      <p className="text-xs text-gray-500">{album.photoCount} photo{album.photoCount !== 1 ? 's' : ''}</p>
                    </button>
                    {isAdmin && (
                      <div className="absolute top-2 right-2">
                        {confirmDeleteAlbumId === album.id ? (
                          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => { deleteAlbum.mutate(album.id); setConfirmDeleteAlbumId(null) }}
                              disabled={deleteAlbum.isPending}
                              className="text-xs px-2 py-1 rounded-lg bg-red-900 text-red-200 hover:bg-red-800 transition-colors disabled:opacity-50"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteAlbumId(null)}
                              className="text-xs px-2 py-1 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteAlbumId(album.id) }}
                            className="hidden group-hover:flex items-center justify-center w-6 h-6 bg-red-600/80 hover:bg-red-600 text-white rounded-full text-xs"
                            aria-label="Delete album"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {/* Album detail — photos in selected album */}
          {mediaSubTab === 'albums' && selectedAlbum && (
            <div>
              <div className="mb-3">
                <p className="text-base font-semibold text-gray-100">{selectedAlbum.name}</p>
                {selectedAlbum.description && <p className="text-sm text-gray-400 mt-0.5">{selectedAlbum.description}</p>}
              </div>
              {albumPhotosLoading ? (
                <PhotoGridSkeleton />
              ) : !albumPhotosData?.media?.length ? (
                <div>
                  <EmptyState title="No photos in this album" description={isAdmin ? 'Add photos from the All Photos tab.' : 'No photos have been added yet.'} />
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => { setSelectedAlbum(null); setMediaSubTab('all') }}
                      className="mt-3 w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
                    >
                      Go to All Photos
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 sm:gap-1.5">
                  {albumPhotosData.media.map((photo, i) => (
                    <div key={photo.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => setMediaLightboxIndex(i)}
                        className="w-full aspect-square overflow-hidden rounded-lg bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <img src={photo.url} alt={photo.filename} className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" loading="lazy" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => removeFromAlbum.mutate(photo.id)}
                          className="absolute top-1 right-1 hidden group-hover:flex items-center justify-center w-5 h-5 bg-red-600/80 hover:bg-red-600 text-white rounded-full text-xs"
                          aria-label="Remove from album"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Lightboxes */}
          {mediaSubTab === 'all' && mediaLightboxIndex !== null && lightboxMedia.length > 0 && (
            <MediaLightbox
              media={lightboxMedia}
              initialIndex={mediaLightboxIndex}
              onClose={() => setMediaLightboxIndex(null)}
              currentUserId={currentUser?.id}
              isAdmin={isAdmin}
              onSaveCaption={handleSaveCaptionGroup}
              onDelete={isAdmin ? async (assetId) => { await deleteGroupMedia.mutateAsync(assetId) } : undefined}
            />
          )}
          {mediaSubTab === 'albums' && selectedAlbum && mediaLightboxIndex !== null && albumLightboxMedia.length > 0 && (
            <MediaLightbox
              media={albumLightboxMedia}
              initialIndex={mediaLightboxIndex}
              onClose={() => setMediaLightboxIndex(null)}
              currentUserId={currentUser?.id}
              isAdmin={isAdmin}
              onSaveCaption={handleSaveCaptionGroup}
              onDelete={isAdmin ? async (assetId) => { await deleteGroupMedia.mutateAsync(assetId) } : undefined}
            />
          )}
        </div>
      )}

      {/* Create Album Modal */}
      {showCreateAlbumModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowCreateAlbumModal(false)}>
          <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-gray-700 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white">New Album</h2>
            <form onSubmit={handleCreateAlbum} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Album name</label>
                <input
                  type="text"
                  value={newAlbumName}
                  onChange={(e) => setNewAlbumName(e.target.value.slice(0, 80))}
                  placeholder="e.g. Summer 2026"
                  maxLength={80}
                  required
                  autoFocus
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowCreateAlbumModal(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">Cancel</button>
                <button type="submit" disabled={createAlbum.isPending} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50">
                  {createAlbum.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreateChannelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-gray-700 space-y-4">
            <h2 className="text-lg font-bold text-white">Create Channel</h2>
            <form onSubmit={handleCreateChannel} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Channel name</label>
                <div className="flex items-center bg-gray-800 border border-gray-700 rounded-xl px-3 py-2">
                  <span className="text-gray-500 mr-1">#</span>
                  <input
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value.toLowerCase().replace(/\s/g, '-'))}
                    placeholder="e.g. general, announcements"
                    maxLength={32}
                    className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
                    autoFocus
                  />
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newChannelInviteOnly}
                  onChange={(e) => setNewChannelInviteOnly(e.target.checked)}
                  className="w-4 h-4 rounded accent-indigo-500"
                />
                <span className="text-sm text-gray-300">Invite-only channel</span>
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowCreateChannelModal(false); setNewChannelName('') }}
                  className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newChannelName.trim() || createChannel.isPending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  {createChannel.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Calendar Settings Modal */}
      {showCalendarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-700 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Calendar Feed</h2>
              <button type="button" onClick={() => setShowCalendarModal(false)} className="text-gray-500 hover:text-gray-300 text-sm">✕</button>
            </div>

            {/* Feed URL */}
            {calendarPrefs?.feedUrl ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">Your personal feed URL — paste into Apple Calendar, Google Calendar, or Outlook.</p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={calendarPrefs.feedUrl}
                    className="flex-1 min-w-0 text-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(calendarPrefs.feedUrl)
                      setCopiedFeedUrl(true)
                      setTimeout(() => setCopiedFeedUrl(false), 2000)
                    }}
                    className="shrink-0 px-3 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white text-xs font-medium transition-colors"
                  >
                    {copiedFeedUrl ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <a
                  href={calendarPrefs.feedUrl.replace(/^https?:/, 'webcal:')}
                  className="inline-block text-xs text-indigo-400 hover:text-indigo-300 underline"
                >
                  Open in calendar app
                </a>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Loading your feed URL…</p>
            )}

            <hr className="border-gray-700" />

            {/* Filter settings */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-200">Which events appear in your feed?</p>
              {(['all', 'rsvp', 'tags'] as const).map((mode) => (
                <label key={mode} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="calendarFilter"
                    value={mode}
                    checked={calendarFilterMode === mode}
                    onChange={() => setCalendarFilterMode(mode)}
                    className="mt-0.5 accent-indigo-500"
                  />
                  <span className="text-sm text-gray-300">
                    {mode === 'all' && 'All events'}
                    {mode === 'rsvp' && 'Only events I RSVPed Yes or Maybe to'}
                    {mode === 'tags' && 'Only events with specific tags'}
                  </span>
                </label>
              ))}

              {calendarFilterMode === 'tags' && (
                <div className="ml-6 space-y-2 pt-1">
                  {groupTags.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No tags in this group yet.</p>
                  ) : groupTags.map((tag) => (
                    <label key={tag.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={calendarTagIds.includes(tag.id)}
                        onChange={(e) => setCalendarTagIds((prev) =>
                          e.target.checked ? [...prev, tag.id] : prev.filter((id) => id !== tag.id)
                        )}
                        className="w-4 h-4 rounded accent-indigo-500"
                      />
                      {tag.color && (
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                      )}
                      <span className="text-sm text-gray-200">{tag.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCalendarModal(false)}
                className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCalendarPrefs}
                disabled={updateCalendarPrefs.isPending}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
              >
                {updateCalendarPrefs.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── PollsTab ──────────────────────────────────────────────────────────────

type PollsTabProps = {
  groupId: string
  polls: Poll[]
  currentUserId: string
  onCreatePoll: () => void
  onEditPoll: (poll: Poll) => void
  onDeletePoll: (pollId: string) => void
  onVote: (pollId: string, optionId: string, answer: 'yes' | 'no' | 'maybe') => void
  onRemoveVote: (pollId: string, optionId: string) => void
}

function PollsTab({ groupId: _g, polls, currentUserId, onCreatePoll, onEditPoll, onDeletePoll, onVote, onRemoveVote }: PollsTabProps) {
  const [confirmDeletePollId, setConfirmDeletePollId] = useState<string | null>(null)
  const [expandedPollIds, setExpandedPollIds] = useState<Set<string>>(new Set())

  const toggleExpand = (id: string) => {
    setExpandedPollIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Polls</h3>
        <button
          onClick={onCreatePoll}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
        >
          + Create Poll
        </button>
      </div>

      {polls.length === 0 ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          }
          title="No polls yet"
          description="Create a poll to help the group decide on a time, place, or option."
        />
      ) : (
        <div className="space-y-3">
          {polls.map((poll) => {
            const isExpanded = expandedPollIds.has(poll.id)
            const canManage = poll.isCreator || poll.isAdmin
            const totalVoters = poll.options.length > 0
              ? Math.max(...poll.options.map((o) => o.votes.yes + o.votes.no + o.votes.maybe))
              : 0

            return (
              <div key={poll.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                {/* Poll header */}
                <button
                  type="button"
                  onClick={() => toggleExpand(poll.id)}
                  className="w-full text-left px-4 py-4 flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium leading-snug">{poll.question}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {poll.createdBy ? `by ${poll.createdBy.name}` : 'Deleted user'} ·{' '}
                      {new Date(poll.createdAt).toLocaleDateString()} ·{' '}
                      {poll.options.length} option{poll.options.length !== 1 ? 's' : ''}
                      {totalVoters > 0 && ` · ${totalVoters} response${totalVoters !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`h-4 w-4 text-gray-500 shrink-0 mt-0.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Options (expanded) */}
                {isExpanded && (
                  <div className="border-t border-gray-800 px-4 pb-4 pt-3 space-y-3">
                    {poll.options.map((opt) => {
                      const my = opt.votes.myAnswer
                      const total = opt.votes.yes + opt.votes.no + opt.votes.maybe

                      const handleVoteClick = (answer: 'yes' | 'no' | 'maybe') => {
                        if (my === answer) {
                          onRemoveVote(poll.id, opt.id)
                        } else {
                          onVote(poll.id, opt.id, answer)
                        }
                      }

                      return (
                        <div key={opt.id} className="bg-gray-800/50 rounded-xl p-3 space-y-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white">{opt.title}</p>
                            {opt.dateTime && (
                              <p className="text-xs text-indigo-400 mt-0.5">
                                {new Date(opt.dateTime).toLocaleString(undefined, {
                                  weekday: 'short', month: 'short', day: 'numeric',
                                  hour: 'numeric', minute: '2-digit',
                                })}
                              </p>
                            )}
                            {opt.location && (
                              <p className="text-xs text-gray-500 mt-0.5">📍 {opt.location}</p>
                            )}
                            {opt.description && (
                              <p className="text-xs text-gray-400 mt-0.5">{opt.description}</p>
                            )}
                          </div>

                          {/* Vote buttons */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {(['yes', 'no', 'maybe'] as const).map((answer) => {
                              const count = opt.votes[answer]
                              const isActive = my === answer
                              const colors: Record<string, string> = {
                                yes: isActive ? 'bg-green-700 border-green-600 text-green-100' : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-green-700 hover:text-green-400',
                                no: isActive ? 'bg-red-900 border-red-700 text-red-100' : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-red-700 hover:text-red-400',
                                maybe: isActive ? 'bg-yellow-800 border-yellow-600 text-yellow-100' : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-yellow-600 hover:text-yellow-400',
                              }
                              const labels: Record<string, string> = { yes: '✓ Yes', no: '✗ No', maybe: '? Maybe' }
                              return (
                                <button
                                  key={answer}
                                  type="button"
                                  onClick={() => handleVoteClick(answer)}
                                  disabled={!currentUserId}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${colors[answer]}`}
                                >
                                  {labels[answer]}
                                  {count > 0 && (
                                    <span className={`font-bold ${isActive ? 'opacity-100' : 'opacity-70'}`}>{count}</span>
                                  )}
                                </button>
                              )
                            })}
                            {total > 0 && (
                              <span className="text-xs text-gray-600 ml-auto">{total} vote{total !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Poll actions */}
                    {canManage && (
                      <div className="flex items-center gap-3 pt-1 border-t border-gray-800">
                        <button
                          type="button"
                          onClick={() => onEditPoll(poll)}
                          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeletePollId(poll.id)}
                          className="text-xs text-red-500 hover:text-red-400 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeletePollId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-white">Delete poll?</h3>
            <p className="text-sm text-gray-400">All votes will be lost. This can't be undone.</p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeletePollId(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 text-sm hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeletePoll(confirmDeletePollId)
                  setConfirmDeletePollId(null)
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm font-semibold transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
