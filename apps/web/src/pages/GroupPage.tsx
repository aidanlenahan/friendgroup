import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  useGroup,
  useGroupMembers,
  useGroupTags,
  useGroupChannels,
  useSubscribeGroupChannel,
  useUnsubscribeGroupChannel,
  useUpdateMemberRole,
  useRemoveMember,
} from '../hooks/useGroups'
import { useEvents, useDeleteEvent } from '../hooks/useEvents'
import EventCard from '../components/EventCard'
import TagBadge from '../components/TagBadge'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import EmptyState from '../components/EmptyState'
import { getApiErrorMessage } from '../lib/api'
import { useToast } from '../hooks/useToast'
import { useIsOnline } from '../hooks/useIsOnline'
import { useAuthStore } from '../stores/authStore'

type Tab = 'events' | 'members' | 'tags' | 'channels'

type EventSummary = {
  id: string
  title: string
  dateTime: string
  location?: string | null
  tags?: Array<{ id: string; name: string; color?: string | null }>
  rsvps?: Array<{ status: string }>
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
  const { data: tagsData } = useGroupTags(groupId!)
  const { data: channelsData } = useGroupChannels(groupId!)
  const { data: eventsData, isLoading: eventsLoading } = useEvents(groupId!)
  const subscribeChannel = useSubscribeGroupChannel(groupId!)
  const unsubscribeChannel = useUnsubscribeGroupChannel(groupId!)
  const updateMemberRole = useUpdateMemberRole(groupId!)
  const removeMember = useRemoveMember(groupId!)

  // Determine current user's role in this group
  const myMembership = membersData?.members?.find((m) => m.userId === currentUser?.id)
  const isOwner = myMembership?.role === 'owner'
  const isAdmin = isOwner || myMembership?.role === 'admin'

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
      toast.success('Member removed')
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to remove member'))
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
        <p>{!isOnline ? 'You are offline and there is no cached data.' : getApiErrorMessage(groupErrorDetails, 'Failed to load group.')}</p>
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
    { key: 'tags', label: 'Tags' },
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
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">{group.name}</h2>
        {group.description && <p className="text-gray-400 mt-1">{group.description}</p>}
        <p className="text-gray-500 text-sm mt-1">
          {group._count?.memberships ?? 0} members
        </p>
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
      {activeTab === 'events' && (
        <div>
          <div className="flex justify-end mb-4">
            <Link
              to={`/groups/${groupId}/events/new`}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {eventsData.events.map((event) => (
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

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div className="space-y-2">
          {membersData?.members?.map((m) => (
            <div
              key={m.userId}
              className="flex items-center gap-3 bg-gray-900 rounded-xl p-3 border border-gray-800"
            >
              <Avatar name={m.name} avatarUrl={m.avatarUrl} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{m.name}</p>
                {m.username && (
                  <p className="text-xs text-indigo-400">@{m.username}</p>
                )}
                <p className="text-xs text-gray-500">{m.email}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                m.role === 'owner'
                  ? 'bg-indigo-900 text-indigo-300'
                  : m.role === 'admin'
                  ? 'bg-amber-900 text-amber-300'
                  : 'bg-gray-800 text-gray-400'
              }`}>
                {m.role}
              </span>
              {isOwner && m.userId !== currentUser?.id && m.role !== 'owner' && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleRoleToggle(m.userId, m.role)}
                    disabled={updateMemberRole.isPending}
                    className="text-xs px-2 py-1 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
                    title={m.role === 'admin' ? 'Demote to member' : 'Promote to admin'}
                  >
                    {m.role === 'admin' ? 'Demote' : 'Promote'}
                  </button>
                  {confirmRemoveMember === m.userId ? (
                    <>
                      <button
                        onClick={() => handleRemoveMember(m.userId)}
                        disabled={removeMember.isPending}
                        className="text-xs px-2 py-1 rounded-lg bg-red-900 text-red-300 hover:bg-red-800 transition-colors disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmRemoveMember(null)}
                        className="text-xs px-2 py-1 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmRemoveMember(m.userId)}
                      className="text-xs px-2 py-1 rounded-lg bg-gray-800 text-red-400 hover:bg-red-900/30 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tags Tab */}
      {activeTab === 'tags' && (
        <div>
          {!tagsData?.tags?.length ? (
            <EmptyState title="No tags" description="Tags help categorize events in this group." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {tagsData.tags.map((tag) => (
                <TagBadge key={tag.id} name={tag.name} color={tag.color} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Channels Tab */}
      {activeTab === 'channels' && (
        <div className="space-y-2">
          {!channelsData?.channels?.length ? (
            <EmptyState title="No channels" description="Channels are for group discussions." />
          ) : (
            channelsData.channels.map((ch) => (
              <div
                key={ch.id}
                className="flex items-center justify-between gap-3 bg-gray-900 rounded-xl p-3 border border-gray-800"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate"># {ch.name}</p>
                  <p className="text-xs text-gray-500">
                    {ch.subscriberCount} subscribers, {ch.messageCount} messages
                  </p>
                </div>
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
                    {ch.isSubscribed ? 'Unsubscribe' : 'Subscribe'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
