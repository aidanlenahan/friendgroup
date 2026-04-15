import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useEvent, useEventAttendance, useRsvp, useEventRating, useEventMedia } from '../hooks/useEvents'
import type { EventRecord, EventTag } from '../hooks/useEvents'
import { useEventMessages } from '../hooks/useMessages'
import type { EventMessage } from '../hooks/useMessages'
import { useChat } from '../hooks/useChat'
import type { ChatMessage } from '../hooks/useChat'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../hooks/useToast'
import TagBadge from '../components/TagBadge'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import { apiFetch, getApiErrorMessage } from '../lib/api'
import { useIsOnline } from '../hooks/useIsOnline'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function buildGoogleCalLink(event: EventRecord): string {
  const start = new Date(event.dateTime).toISOString().replace(/[-:]/g, '').replace('.000', '')
  const end = event.endsAt
    ? new Date(event.endsAt).toISOString().replace(/[-:]/g, '').replace('.000', '')
    : start
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${start}/${end}`,
    details: event.details ?? '',
    location: event.location ?? '',
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '👎']

function ReactionPicker({ messageId, onReact }: { messageId: string; onReact: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-block mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
        aria-label="Add reaction"
      >
        +😊
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-10 flex gap-1 bg-gray-900 border border-gray-700 rounded-xl p-1 shadow-xl">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => { onReact(emoji); setOpen(false) }}
              className="text-sm hover:scale-125 transition-transform p-1"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function EventPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const currentUser = useAuthStore((s) => s.user)
  const toast = useToast()

  const {
    data: eventResponse,
    isLoading,
    isError: eventError,
    error: eventErrorDetails,
    refetch: refetchEvent,
  } = useEvent(eventId!)
  const { data: attendance } = useEventAttendance(eventId!)
  const { data: mediaData } = useEventMedia(eventId!)
  const { data: messagesData } = useEventMessages(eventId!)
  const rsvp = useRsvp(eventId!)
  const rating = useEventRating(eventId!)

  const isOnline = useIsOnline()
  const { messages: chatMessages, typingUsers, connected, sendMessage, sendTyping } = useChat(eventId!)
  const [messageInput, setMessageInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [localRatingValue, setLocalRatingValue] = useState<number | null>(null)

  const event = eventResponse?.event
  const eventTags = event?.tags ?? []
  const ratingValue = localRatingValue ?? event?.rating ?? 0

  // Merge REST messages with socket messages
  const restMessages = messagesData?.pages?.flatMap((p) => p.messages) ?? []
  const socketMessages: EventMessage[] = chatMessages.map((msg: ChatMessage) => ({
    id: msg.id,
    text: msg.content,
    createdAt: msg.createdAt,
    pinned: msg.pinned,
    user: msg.user
      ? {
          id: msg.userId,
          name: msg.user.name,
          avatarUrl: msg.user.avatarUrl,
        }
      : undefined,
  }))

  const allMessages = [
    ...restMessages,
    ...socketMessages.filter((cm) => !restMessages.some((rm) => rm.id === cm.id)),
  ]

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allMessages.length])

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-indigo-400" />
      </div>
    )
  }

  if (eventError && !event) {
    return (
      <div className="flex flex-col items-center py-16 gap-3 text-gray-400">
        <p>{!isOnline ? 'You are offline and there is no cached data.' : getApiErrorMessage(eventErrorDetails, 'Failed to load event.')}</p>
        {isOnline && (
          <button
            onClick={() => refetchEvent()}
            className="px-4 py-2 rounded-xl bg-gray-800 text-gray-200 text-sm hover:bg-gray-700 transition-colors"
          >
            Try again
          </button>
        )}
      </div>
    )
  }

  if (!event) {
    return <div className="p-6 text-gray-400">Event not found</div>
  }

  const handleSend = () => {
    if (!messageInput.trim()) return
    sendMessage(messageInput.trim())
    setMessageInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    } else {
      sendTyping()
    }
  }

  const handleRsvp = async (status: 'yes' | 'no' | 'maybe') => {
    try {
      await rsvp.mutateAsync(status)
      toast.success(`RSVP updated to ${status}`)
    } catch {
      toast.error('Failed to update RSVP')
    }
  }

  const handleRating = async (value: number) => {
    setLocalRatingValue(value)
    try {
      await rating.mutateAsync({ rating: value })
    } catch {
      toast.error('Failed to save rating')
    }
  }

  const handlePin = async (messageId: string) => {
    try {
      await apiFetch(`/events/${eventId}/messages/${messageId}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: true }),
      })
      toast.success('Message pinned')
    } catch {
      toast.error('Failed to pin message')
    }
  }

  const handleReaction = async (messageId: string, emoji: string, alreadyReacted: boolean) => {
    try {
      if (alreadyReacted) {
        await apiFetch(`/events/${eventId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
          method: 'DELETE',
        })
      } else {
        await apiFetch(`/events/${eventId}/messages/${messageId}/reactions`, {
          method: 'POST',
          body: JSON.stringify({ emoji }),
        })
      }
    } catch {
      // silently ignore — optimistic UX is not critical here
    }
  }

  const counts = attendance?.counts ?? { yes: 0, no: 0, maybe: 0 }

  const icsUrl = `/api/events/${eventId}/calendar.ics`

  return (
    <div className="w-full min-w-0 px-4 py-6 sm:p-6 max-w-5xl mx-auto">
      {eventError && !isOnline && (
        <div className="mb-4 px-4 py-2 rounded-xl bg-yellow-900/40 border border-yellow-700 text-yellow-300 text-sm">
          You are offline. Showing cached data.
        </div>
      )}
      {/* Event Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">{event.title}</h2>
        <p className="text-gray-400 mt-1">{formatDate(event.dateTime)}</p>
        {event.endsAt && (
          <p className="text-gray-500 text-sm">Until {formatDate(event.endsAt)}</p>
        )}
        {event.location && <p className="text-gray-400 text-sm mt-1">{event.location}</p>}
        {event.details && <p className="text-gray-300 mt-3">{event.details}</p>}
        {eventTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {eventTags.map((tag: EventTag) => (
              <TagBadge key={tag.id} name={tag.name} color={tag.color} />
            ))}
          </div>
        )}
        {event.isLegendary && (
          <span className="inline-block mt-2 px-3 py-1 rounded-full bg-amber-900 text-amber-300 text-xs font-bold">
            LEGENDARY
          </span>
        )}
      </div>

      {/* RSVP + Attendance */}
      <section aria-label="RSVP and attendance" className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span id="rsvp-label" className="text-sm text-gray-300">RSVP:</span>
          <div role="group" aria-labelledby="rsvp-label" className="flex flex-wrap gap-2">
          {(['yes', 'no', 'maybe'] as const).map((status) => (
            <button
              key={status}
              onClick={() => handleRsvp(status)}
              disabled={rsvp.isPending}
              aria-label={`RSVP ${status}`}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                status === 'yes'
                  ? 'bg-green-900 text-green-300 hover:bg-green-800'
                  : status === 'maybe'
                    ? 'bg-yellow-900 text-yellow-300 hover:bg-yellow-800'
                    : 'bg-red-900 text-red-300 hover:bg-red-800'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
          </div>
        </div>
        <div className="flex gap-4 text-sm text-gray-400">
          <span>{counts.yes} going</span>
          <span>{counts.maybe} maybe</span>
          <span>{counts.no} can't go</span>
        </div>
        {attendance?.attendees && (
          <div className="flex flex-wrap gap-2 mt-3">
            {attendance.attendees
              .filter((a) => a.status === 'yes')
              .map((a) => (
                <Avatar key={a.user.id} name={a.user.name} size="sm" />
              ))}
          </div>
        )}
      </section>
      {/* Calendar Links */}
      <div className="flex flex-wrap gap-3 mb-6">
        <a
          href={icsUrl}
          className="px-3 py-2 rounded-xl bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
        >
          Download .ics
        </a>
        <a
          href={buildGoogleCalLink(event)}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 rounded-xl bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
        >
          Add to Google Calendar
        </a>
      </div>

      {/* Rating */}
      <section aria-label="Event rating" className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6">
        <p id="rating-label" className="text-sm text-gray-300 mb-2">Rate this event (1-10)</p>
        <div role="group" aria-labelledby="rating-label" className="flex flex-wrap gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => handleRating(n)}
              aria-label={`Rate ${n} out of 10`}
              aria-pressed={n <= ratingValue}
              className={`w-8 h-8 rounded-lg text-sm font-bold transition-colors ${
                n <= ratingValue
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chat Panel */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl flex flex-col h-[60vh] sm:h-[500px]">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-300">Event Chat</h3>
            <span
              className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {allMessages.map((msg) => (
              <div
                key={msg.id}
                className={`${msg.pinned ? 'bg-indigo-950 border border-indigo-800 rounded-lg p-2' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <Avatar name={msg.user?.name ?? 'Unknown'} avatarUrl={msg.user?.avatarUrl} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-300">
                        {msg.user?.name ?? 'Unknown'}
                      </span>
                      <span className="text-xs text-gray-600">
                        {new Date(msg.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {msg.pinned && (
                        <span className="text-xs text-indigo-400">pinned</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-200 break-words">{msg.text}</p>
                    {/* Reactions */}
                    {msg.reactions && msg.reactions.length > 0 && (() => {
                      const grouped = msg.reactions.reduce<Record<string, { count: number; mine: boolean }>>((acc, r) => {
                        if (!acc[r.emoji]) acc[r.emoji] = { count: 0, mine: false }
                        acc[r.emoji].count++
                        if (r.userId === currentUser?.id) acc[r.emoji].mine = true
                        return acc
                      }, {})
                      return (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(grouped).map(([emoji, { count, mine }]) => (
                            <button
                              key={emoji}
                              onClick={() => handleReaction(msg.id, emoji, mine)}
                              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                                mine
                                  ? 'bg-indigo-900/60 border-indigo-600 text-indigo-200'
                                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'
                              }`}
                            >
                              {emoji} {count}
                            </button>
                          ))}
                        </div>
                      )
                    })()}
                    {/* Add reaction picker */}
                    <ReactionPicker messageId={msg.id} onReact={(emoji) => handleReaction(msg.id, emoji, false)} />
                  </div>
                  {currentUser && (
                    <button
                      onClick={() => handlePin(msg.id)}
                      className="text-xs text-gray-600 hover:text-gray-300"
                      title="Pin message"
                    >
                      pin
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          {typingUsers.length > 0 && (
            <div role="status" aria-live="polite" className="px-4 py-1 text-xs text-gray-500">
              {typingUsers.join(', ')} typing...
            </div>
          )}
          <div className="p-3 border-t border-gray-800">
            <div className="flex gap-2">
              <input
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                aria-label="Chat message"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleSend}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* Media Section */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Media</h3>
          {!mediaData?.media?.length ? (
            <p className="text-gray-500 text-sm">No media uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {mediaData.media.map((m) => (
                <a
                  key={m.id}
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square bg-gray-800 rounded-lg overflow-hidden"
                >
                  {m.mimeType.startsWith('image/') ? (
                    <img
                      src={m.url}
                      alt={m.filename}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                      {m.filename}
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
