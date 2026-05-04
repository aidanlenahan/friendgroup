import { Link } from 'react-router-dom'
import TagBadge from './TagBadge'

function LockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5 text-gray-500 shrink-0"
      aria-label="Private event"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

interface EventCardProps {
  event: {
    id: string
    title: string
    dateTime: string
    location?: string | null
    isPrivate?: boolean
    tags?: Array<{ id: string; name: string; color?: string | null }>
    rsvps?: Array<{ status: string }>
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function EventCard({ event }: EventCardProps) {
  const yesCount = event.rsvps?.filter((r) => r.status === 'yes').length ?? 0
  const maybeCount = event.rsvps?.filter((r) => r.status === 'maybe').length ?? 0

  return (
    <Link
      to={`/events/${event.id}`}
      className="block bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-indigo-600 transition-colors group"
    >
      <h3 className="font-semibold text-white group-hover:text-indigo-300 mb-1 flex items-center gap-1.5">
        {event.isPrivate && <LockIcon />}
        {event.title}
      </h3>
      <p className="text-gray-400 text-sm">{formatDate(event.dateTime)}</p>
      {event.location && (
        <p className="text-gray-500 text-xs mt-1">{event.location}</p>
      )}
      {event.tags && event.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {event.tags.map((tag) => (
            <TagBadge key={tag.id} name={tag.name} color={tag.color} />
          ))}
        </div>
      )}
      <div className="flex gap-3 mt-3 text-xs text-gray-500">
        <span>{yesCount} going</span>
        {maybeCount > 0 && <span>{maybeCount} maybe</span>}
      </div>
    </Link>
  )
}
