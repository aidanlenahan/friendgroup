import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useGroups } from '../hooks/useGroups'
import type { GroupSummary } from '../hooks/useGroups'
import ToastContainer from './Toast'

export default function Layout() {
  const getIsDesktop = () =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches

  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const { data: groups } = useGroups()
  const [isDesktop, setIsDesktop] = useState(getIsDesktop)
  const [sidebarOpen, setSidebarOpen] = useState(getIsDesktop)
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [showReconnected, setShowReconnected] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)')

    const syncSidebarState = (desktop: boolean) => {
      setIsDesktop(desktop)
      setSidebarOpen(desktop)
    }

    syncSidebarState(mediaQuery.matches)

    const handleChange = (event: MediaQueryListEvent) => {
      syncSidebarState(event.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    const handleOffline = () => {
      setIsOnline(false)
      setShowReconnected(false)
    }

    const handleOnline = () => {
      setIsOnline(true)
      setShowReconnected(true)
      window.setTimeout(() => setShowReconnected(false), 3000)
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const closeSidebar = () => {
    if (!isDesktop) {
      setSidebarOpen(false)
    }
  }

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <p className="text-xl font-bold text-indigo-400">Friendgroup</p>
          <p className="text-xs text-gray-500 mt-1">{user?.name}</p>
        </div>
        {/* Close button on mobile */}
        {!isDesktop && <button
          onClick={closeSidebar}
          aria-label="Close menu"
          className="p-1 text-gray-400 hover:text-gray-100"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>}
      </div>
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-3 space-y-1">
        <p className="text-xs uppercase tracking-wider text-gray-500 px-2 mb-2">
          Your Groups
        </p>
        {groups?.groups?.map((g: GroupSummary) => (
          <NavLink
            key={g.id}
            to={`/groups/${g.id}`}
            onClick={closeSidebar}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`
            }
          >
            <span className="w-6 h-6 rounded-full bg-indigo-900 flex items-center justify-center text-xs font-bold">
              {g.name[0].toUpperCase()}
            </span>
            {g.name}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-gray-800 space-y-1">
        <NavLink
          to="/settings"
          onClick={closeSidebar}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800"
        >
          Settings
        </NavLink>
        <button
          onClick={handleLogout}
          className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-gray-800"
        >
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="flex h-dvh w-full overflow-x-hidden bg-gray-950 text-gray-100">
      <ToastContainer />

      {/* Mobile overlay */}
      {sidebarOpen && !isDesktop && (
        <div
          className="fixed inset-0 z-20 bg-black/60"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — controlled in JS for stable desktop visibility across reloads */}
      <aside
        aria-label="Sidebar navigation"
        className={`${isDesktop ? 'static inset-auto left-auto shrink-0' : 'fixed inset-y-0 left-0'} z-30 w-64 flex flex-col bg-gray-900 border-r border-gray-800 transform transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
      >
        {sidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        {!isDesktop && <header className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="p-1 text-gray-400 hover:text-gray-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-bold text-indigo-400">Friendgroup</span>
        </header>}

        {!isOnline && (
          <div className="px-4 py-2 bg-amber-900/60 border-b border-amber-700 text-amber-100 text-xs">
            Offline mode: actions may fail until your connection is restored.
          </div>
        )}
        {isOnline && showReconnected && (
          <div className="px-4 py-2 bg-emerald-900/60 border-b border-emerald-700 text-emerald-100 text-xs">
            Reconnected. Live updates are back online.
          </div>
        )}

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
