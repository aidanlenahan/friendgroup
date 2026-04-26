import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import PageToolbar from '../components/PageToolbar'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useGroup,
  useGroupMembers,
  useGroupChannels,
  useSubscribeGroupChannel,
  useUnsubscribeGroupChannel,
  useUpdateMemberRole,
  useRemoveMember,
  useGroupInviteCode,
  useRegenerateInviteCode,
  useApproveMember,
  useDenyMember,
} from '../hooks/useGroups'
import { useEvents, useDeleteEvent } from '../hooks/useEvents'
import EventCard from '../components/EventCard'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import EmptyState from '../components/EmptyState'
import { getApiErrorMessage, ApiError, apiFetch } from '../lib/api'
import { useToast } from '../hooks/useToast'
import { useIsOnline } from '../hooks/useIsOnline'
import { useAuthStore } from '../stores/authStore'

type Tab = 'events' | 'members' | 'channels'

type EventSummary = {
  id: string
  title: string
  details?: string | null
  dateTime: string
  endsAt?: string | null
  location?: string | null
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

function AdminEventCard({ event, canDelete }: { event: EventSummary; canDelete: boolean }) {
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
      <EventCard event={event} />
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
  const [activeTab, setActiveTab] = useState<Tab>('events')
  const [confirmRemoveMember, setConfirmRemoveMember] = useState<string | null>(null)
  const [memberActionMenuUserId, setMemberActionMenuUserId] = useState<string | null>(null)
  const [showPastEvents, setShowPastEvents] = useState(false)
  const [eventSearch, setEventSearch] = useState('')
  const [showInviteCode, setShowInviteCode] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const memberActionMenuRef = useRef<HTMLDivElement>(null)
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
  const { data: inviteCodeData, refetch: refetchInviteCode } = useGroupInviteCode(groupId!)
  const subscribeChannel = useSubscribeGroupChannel(groupId!)
  const unsubscribeChannel = useUnsubscribeGroupChannel(groupId!)
  const updateMemberRole = useUpdateMemberRole(groupId!)
  const removeMember = useRemoveMember(groupId!)
  const regenerateCode = useRegenerateInviteCode(groupId!)
  const approveMember = useApproveMember(groupId!)
  const denyMember = useDenyMember(groupId!)

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

  // Determine current user's role in this group
  const myMembership = membersData?.members?.find((m) => m.userId === currentUser?.id)
  const isOwner = myMembership?.role === 'owner'
  const isAdmin = isOwner || myMembership?.role === 'admin'

  const pendingMembers = membersData?.members?.filter((m) => m.status === 'pending') ?? []
  const activeMembers = membersData?.members?.filter((m) => m.status === 'active') ?? []

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

  if (groupLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-indigo-400" />
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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'events', label: 'Events' },
    { key: 'members', label: `Members (${group._count?.memberships ?? 0})` },
    { key: 'channels', label: 'Channels' },
  ]

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
          <p className="text-gray-500 text-sm mt-1">
            {group._count?.memberships ?? 0} members
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && (
            <Link
              to={`/groups/${groupId}/manage`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:border-indigo-600 hover:text-white text-xs font-medium transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Manage
            </Link>
          )}
          <PageToolbar backTo="/groups" />
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-800 overflow-x-auto">
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
              + Create Event
            </Link>
          </div>
          {eventsLoading ? (
            <div className="flex justify-center py-8">
              <Spinner className="text-indigo-400" />
            </div>
          ) : !eventsData?.events?.length ? (
            <EmptyState
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {upcomingEvents.map((event) => (
                    <AdminEventCard
                      key={event.id}
                      event={event}
                      canDelete={isAdmin}
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 opacity-60">
                      {pastEvents.map((event) => (
                        <AdminEventCard
                          key={event.id}
                          event={event}
                          canDelete={isAdmin}
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
              <p className="text-sm text-gray-400">Share this code with people you want to invite. They can use it from the Groups page.</p>
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
                  {copiedCode ? 'Copied!' : 'Copy'}
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
                      <p className="text-xs text-gray-500">{m.email}</p>
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
                    <p className="text-xs text-gray-500">{m.email}</p>
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
      {activeTab === 'channels' && (
        <div className="space-y-2">
          {!channelsData?.channels?.length ? (
            <EmptyState title="No channels" description="Channels are for group discussions. Admins can create channels from the Channels page." />
          ) : (
            channelsData.channels.map((ch) => (
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
                </div>
              </div>
            ))
          )}
          {/* Open channel chat button — always visible if channels exist */}
          {channelsData?.channels && channelsData.channels.length > 0 && (
            <div className="pt-2">
              <Link
                to={`/groups/${groupId}/channels/${channelsData.channels[0].id}`}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-indigo-900/40 border border-indigo-800/60 text-indigo-300 hover:bg-indigo-900/60 transition-colors text-sm font-medium"
              >
                Open #{channelsData.channels[0].name} →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
