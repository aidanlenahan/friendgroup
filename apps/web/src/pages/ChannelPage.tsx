import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useChannelMessages } from '../hooks/useMessages'
import type { ChannelMessage } from '../hooks/useMessages'
import { useChannelChat } from '../hooks/useChat'
import type { ChatMessage } from '../hooks/useChat'
import { useGroupChannels, useCreateChannel } from '../hooks/useGroups'
import { useGroupMembers } from '../hooks/useGroups'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../hooks/useToast'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import { getApiErrorMessage } from '../lib/api'

function formatTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function ChannelPage() {
  const { groupId, channelId } = useParams<{ groupId: string; channelId: string }>()
  const currentUser = useAuthStore((s) => s.user)
  const toast = useToast()

  const { data: channelsData } = useGroupChannels(groupId!)
  const channel = channelsData?.channels.find((c) => c.id === channelId)

  const { data: membersData } = useGroupMembers(groupId!)
  const myMembership = membersData?.members.find((m) => m.userId === currentUser?.id)
  const isAdminOrOwner = myMembership?.role === 'owner' || myMembership?.role === 'admin'

  const { data: messagesData, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useChannelMessages(groupId!, channelId!)

  const { messages: liveMessages, typingUsers, connected, sendMessage, sendTyping } =
    useChannelChat(groupId!, channelId!)

  const [input, setInput] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelInviteOnly, setNewChannelInviteOnly] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const createChannel = useCreateChannel(groupId!)

  // Merge REST messages with live socket messages
  const restMessages: ChannelMessage[] =
    messagesData?.pages.flatMap((p) => p.messages) ?? []

  const socketMessages: ChannelMessage[] = liveMessages.map((m: ChatMessage) => ({
    id: m.id,
    content: m.content,
    createdAt: m.createdAt,
    userId: m.userId,
    user: m.user
      ? { id: m.userId, name: m.user.name, email: '', avatarUrl: m.user.avatarUrl }
      : undefined,
  }))

  const allMessages = [
    ...restMessages,
    ...socketMessages.filter((sm) => !restMessages.some((rm) => rm.id === sm.id)),
  ]

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allMessages.length])

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || !connected) return
    sendMessage(trimmed)
    setInput('')
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    sendTyping()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend(e as unknown as React.FormEvent)
    }
  }

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newChannelName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (!name) return
    try {
      await createChannel.mutateAsync({ name, isInviteOnly: newChannelInviteOnly })
      toast.success(`#${name} created`)
      setShowCreateModal(false)
      setNewChannelName('')
      setNewChannelInviteOnly(false)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to create channel'))
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Sidebar: channel list */}
      <aside className="hidden md:flex flex-col w-52 flex-shrink-0 bg-gray-900 border-r border-gray-800 overflow-y-auto">
        <div className="flex items-center justify-between px-3 pt-4 pb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Channels</span>
          {isAdminOrOwner && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="text-gray-400 hover:text-white text-lg leading-none"
              title="New channel"
            >
              +
            </button>
          )}
        </div>
        {channelsData?.channels.map((ch) => (
          <Link
            key={ch.id}
            to={`/groups/${groupId}/channels/${ch.id}`}
            className={`px-3 py-2 text-sm rounded-lg mx-1 flex items-center gap-1 transition-colors ${
              ch.id === channelId
                ? 'bg-indigo-900 text-white font-medium'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            <span className="text-gray-500">#</span>
            <span className="truncate">{ch.name}</span>
          </Link>
        ))}
        <div className="mt-auto p-3">
          <Link
            to={`/groups/${groupId}`}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Back to group
          </Link>
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-950 flex-shrink-0">
          <Link
            to={`/groups/${groupId}`}
            className="md:hidden text-gray-400 hover:text-white mr-1"
          >
            ←
          </Link>
          <span className="text-gray-400 text-lg">#</span>
          <h1 className="font-semibold text-white truncate">
            {channel?.name ?? 'Channel'}
          </h1>
          {channel?.isInviteOnly && (
            <span className="text-xs bg-amber-900 text-amber-300 px-2 py-0.5 rounded-full">
              Invite-only
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-gray-600'}`}
              title={connected ? 'Live' : 'Connecting…'}
            />
            {isAdminOrOwner && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="md:hidden text-xs text-indigo-400 hover:text-indigo-300"
              >
                + Channel
              </button>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {hasNextPage && (
            <div className="flex justify-center">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
              >
                {isFetchingNextPage ? 'Loading…' : 'Load older messages'}
              </button>
            </div>
          )}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner className="text-indigo-400" />
            </div>
          ) : allMessages.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-gray-500 text-sm gap-2">
              <span className="text-3xl">#</span>
              <p>This is the beginning of <strong className="text-gray-300">#{channel?.name ?? 'this channel'}</strong>.</p>
              <p>Be the first to say something!</p>
            </div>
          ) : (
            allMessages.map((msg) => (
              <div key={msg.id} className="flex items-start gap-3">
                <Avatar
                  name={msg.user?.name ?? 'Unknown'}
                  avatarUrl={msg.user?.avatarUrl ?? undefined}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">
                      {msg.user?.name ?? 'Unknown'}
                    </span>
                    <span className="text-xs text-gray-500">{formatTime(msg.createdAt)}</span>
                  </div>
                  <p className="text-sm text-gray-200 break-words whitespace-pre-wrap mt-0.5">
                    {msg.content}
                  </p>
                </div>
              </div>
            ))
          )}
          {typingUsers.length > 0 && (
            <p className="text-xs text-gray-500 italic">
              {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
            </p>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSend}
          className="px-4 pb-4 pt-2 border-t border-gray-800 bg-gray-950 flex-shrink-0"
        >
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={connected ? `Message #${channel?.name ?? 'channel'}` : 'Connecting…'}
              disabled={!connected}
              rows={1}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 text-sm"
              style={{ maxHeight: '8rem', overflowY: 'auto' }}
            />
            <button
              type="submit"
              disabled={!input.trim() || !connected}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl text-sm font-medium transition-colors flex-shrink-0"
            >
              Send
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-1">Enter to send · Shift+Enter for new line</p>
        </form>
      </div>

      {/* Create Channel Modal */}
      {showCreateModal && (
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
                  onClick={() => { setShowCreateModal(false); setNewChannelName('') }}
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
    </div>
  )
}
