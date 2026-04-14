import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useGroup, useGroupMembers, useGroupTags, useGroupChannels } from '../hooks/useGroups'
import { useEvents } from '../hooks/useEvents'
import EventCard from '../components/EventCard'
import TagBadge from '../components/TagBadge'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import EmptyState from '../components/EmptyState'

type Tab = 'events' | 'members' | 'tags' | 'channels'

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const [activeTab, setActiveTab] = useState<Tab>('events')

  const { data: groupData, isLoading: groupLoading, isError: groupError, refetch: refetchGroup } = useGroup(groupId!)
  const { data: membersData } = useGroupMembers(groupId!)
  const { data: tagsData } = useGroupTags(groupId!)
  const { data: channelsData } = useGroupChannels(groupId!)
  const { data: eventsData, isLoading: eventsLoading } = useEvents(groupId!)

  if (groupLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-indigo-400" />
      </div>
    )
  }

  const group = groupData?.group

  if (groupError) {
    return (
      <div className="flex flex-col items-center py-16 gap-3 text-gray-400">
        <p>Failed to load group.</p>
        <button
          onClick={() => refetchGroup()}
          className="px-4 py-2 rounded-xl bg-gray-800 text-gray-200 text-sm hover:bg-gray-700 transition-colors"
        >
          Try again
        </button>
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
    <div className="p-6 max-w-5xl mx-auto">
      {/* Group Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">{group.name}</h2>
        {group.description && <p className="text-gray-400 mt-1">{group.description}</p>}
        <p className="text-gray-500 text-sm mt-1">
          {group._count?.memberships ?? 0} members
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
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
                <EventCard key={event.id} event={event} />
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
                <p className="text-xs text-gray-500">{m.email}</p>
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-400">
                {m.role}
              </span>
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
                className="flex items-center justify-between bg-gray-900 rounded-xl p-3 border border-gray-800"
              >
                <div>
                  <p className="text-sm font-medium text-white"># {ch.name}</p>
                  <p className="text-xs text-gray-500">
                    {ch.subscriberCount} subscribers, {ch.messageCount} messages
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    ch.isSubscribed
                      ? 'bg-indigo-900 text-indigo-300'
                      : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  {ch.isSubscribed ? 'Subscribed' : 'Not subscribed'}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
