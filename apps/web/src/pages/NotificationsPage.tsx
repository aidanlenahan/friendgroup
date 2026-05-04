import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useNotificationInbox,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDismissNotification,
  useDismissAllNotifications,
  type InboxNotification,
} from '../hooks/useNotifications'
import PageToolbar from '../components/PageToolbar'

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

const TYPE_LABELS: Record<string, string> = {
  chat_message: 'Chat',
  event_created: 'New Event',
  event_changed: 'Event Update',
  invite: 'Invite',
  rsvp_update: 'RSVP',
}

const ALL_TYPES = Object.keys(TYPE_LABELS)

type Tab = 'unread' | 'all'

export default function NotificationsPage() {
  const navigate = useNavigate()
  const { data, isLoading } = useNotificationInbox()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const dismiss = useDismissNotification()
  const dismissAll = useDismissAllNotifications()

  const [tab, setTab] = useState<Tab>('unread')
  const [activeType, setActiveType] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const all = data?.notifications ?? []
  const unread = useMemo(() => all.filter((n) => !n.readAt), [all])
  const base = tab === 'unread' ? unread : all

  const filtered = useMemo(() => {
    let result = base
    if (activeType) result = result.filter((n) => n.type === activeType)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
      )
    }
    return result
  }, [base, activeType, search])

  const isFiltered = activeType !== null || search.trim() !== ''

  function clearFilters() {
    setActiveType(null)
    setSearch('')
  }

  function handleClick(n: InboxNotification) {
    if (!n.readAt) markRead.mutate(n.id)
    if (n.url) navigate(n.url)
  }

  const presentTypes = ALL_TYPES.filter((t) => base.some((n) => n.type === t))

  return (
    <div className="px-4 py-6 sm:p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-white">Notifications</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/settings/notifications')}
            aria-label="Notification settings"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <PageToolbar />
        </div>
      </div>

      {/* Tabs + action */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          {(['unread', 'all'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); clearFilters() }}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t === 'unread' ? (
                <>Unread{unread.length > 0 && <span className="ml-1.5 text-xs text-indigo-400">{unread.length}</span>}</>
              ) : 'All'}
            </button>
          ))}
        </div>

        {/* Tab-level action */}
        {tab === 'unread' && unread.length > 0 && (
          <button
            onClick={() => markAllRead.mutate()}
            className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Mark all read
          </button>
        )}
        {tab === 'all' && all.length > 0 && (
          <button
            onClick={() => dismissAll.mutate()}
            className="text-sm text-red-400 hover:text-red-300 transition-colors"
          >
            Delete all
          </button>
        )}
      </div>

      {/* Filter bar — only when there's something to filter */}
      {!isLoading && base.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveType(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeType === null
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              All
            </button>
            {presentTypes.map((t) => (
              <button
                key={t}
                onClick={() => setActiveType(activeType === t ? null : t)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeType === t
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <div className="relative">
            <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, content, or person…"
              className="w-full pl-8 pr-8 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {isFiltered && (
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{filtered.length} of {base.length}</span>
              <button onClick={clearFilters} className="text-indigo-400 hover:text-indigo-300 transition-colors">
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* List */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="px-4 py-12 text-center text-sm text-gray-500">Loading…</div>
        ) : base.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 mx-auto text-gray-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="text-sm text-gray-500">
              {tab === 'unread' ? "You're all caught up" : 'No notifications'}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {tab === 'unread'
                ? 'No unread notifications'
                : 'No notifications from the last 7 days'}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-gray-500">No notifications match your filters</p>
            <button onClick={clearFilters} className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              Clear filters
            </button>
          </div>
        ) : (
          <ul>
            {filtered.map((n, i) => (
              <li key={n.id} className={i > 0 ? 'border-t border-gray-800' : ''}>
                <div className={`flex items-start gap-3 px-4 py-4 transition-colors group ${n.readAt ? 'hover:bg-gray-800/60' : 'hover:bg-gray-800'}`}>
                  {/* Unread dot — only on unread items in All tab */}
                  <span
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${!n.readAt ? 'bg-indigo-500' : 'bg-transparent'}`}
                    aria-hidden="true"
                  />
                  <button onClick={() => handleClick(n)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-indigo-400">
                        {TYPE_LABELS[n.type] ?? n.type}
                      </span>
                      <span className="text-xs text-gray-600">{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className={`text-sm font-medium leading-snug ${n.readAt ? 'text-gray-400 group-hover:text-gray-300' : 'text-white group-hover:text-indigo-300'}`}>
                      {n.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>
                  </button>
                  <button
                    onClick={() => dismiss.mutate(n.id)}
                    aria-label="Delete notification"
                    className="shrink-0 p-1 text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
