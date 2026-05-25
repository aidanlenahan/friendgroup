import { memo } from 'react'
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
  layout?: 'grid' | 'list'
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

function formatDateShort(iso: string): { month: string; day: string; time: string } {
  const d = new Date(iso)
  return {
    month: d.toLocaleDateString(undefined, { month: 'short' }),
    day: String(d.getDate()),
    time: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  }
}

function EventCard({ event, layout = 'grid' }: EventCardProps) {
  const yesCount = event.rsvps?.filter((r) => r.status === 'yes').length ?? 0
  const maybeCount = event.rsvps?.filter((r) => r.status === 'maybe').length ?? 0

  if (layout === 'list') {
    const { month, day, time } = formatDateShort(event.dateTime)
    return (
      <Link
        to={`/events/${event.id}`}
        className="flex items-center gap-3 bg-gray-900 rounded-xl px-3 py-2.5 transition-colors group border border-gray-800 hover:border-indigo-600"
      >
        <div className="flex flex-col items-center justify-center w-10 shrink-0 text-center">
          <span className="text-[10px] uppercase tracking-wider font-medium leading-none text-indigo-400">{month}</span>
          <span className="text-lg font-bold text-white leading-tight">{day}</span>
          <span className="text-[10px] text-gray-500 leading-none">{time}</span>
        </div>
        <div className="w-px self-stretch bg-gray-800 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white group-hover:text-indigo-300 truncate flex items-center gap-1.5">
            {event.isPrivate && <LockIcon />}
            {event.title}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {event.location && (
              <span className="text-xs text-gray-500 truncate">{event.location}</span>
            )}
            {event.tags && event.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {event.tags.map((tag) => (
                  <TagBadge key={tag.id} name={tag.name} color={tag.color} />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="text-xs text-gray-500 shrink-0 text-right">
          <span>{yesCount} going</span>
          {maybeCount > 0 && <span className="ml-1.5">{maybeCount} maybe</span>}
        </div>
      </Link>
    )
  }

  return (
    <Link
      to={`/events/${event.id}`}
      className="block bg-gray-900 rounded-2xl p-4 transition-colors group border border-gray-800 hover:border-indigo-600"
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

export default memo(EventCard)
