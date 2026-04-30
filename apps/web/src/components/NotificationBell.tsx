import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useNotificationInbox,
  useDismissNotification,
  useDismissAllNotifications,
  type InboxNotification,
} from '../hooks/useNotifications'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const { data } = useNotificationInbox()
  const dismiss = useDismissNotification()
  const dismissAll = useDismissAllNotifications()

  const notifications = data?.notifications ?? []
  const count = notifications.length

  // Close panel when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleClick(notification: InboxNotification) {
    dismiss.mutate(notification.id)
    setOpen(false)
    if (notification.url) {
      navigate(notification.url)
    }
  }

  function handleDismissAll() {
    dismissAll.mutate()
  }

  return (
    <div ref={panelRef} className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
        className="relative p-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] flex items-center justify-center rounded-full bg-red-500 text-white text-[0.6rem] font-bold leading-none px-0.5"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl z-50 flex flex-col max-h-[70vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            {count > 0 && (
              <button
                onClick={handleDismissAll}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-500">
                No new notifications
              </p>
            ) : (
              <ul>
                {notifications.map((n) => (
                  <li key={n.id} className="border-b border-gray-800 last:border-0">
                    <button
                      onClick={() => handleClick(n)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-800 transition-colors group flex items-start gap-3"
                    >
                      {/* Dot indicator */}
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-indigo-500 shrink-0" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white group-hover:text-indigo-300 leading-snug truncate">
                          {n.title}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">
                          {n.body}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">{timeAgo(n.createdAt)}</p>
                      </div>
                      {/* Dismiss × */}
                      <button
                        onClick={(e) => { e.stopPropagation(); dismiss.mutate(n.id) }}
                        aria-label="Dismiss notification"
                        className="shrink-0 p-0.5 text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
