import { useEffect, useRef, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useGroups } from '../hooks/useGroups'
import type { GroupSummary } from '../hooks/useGroups'
import ToastContainer from './Toast'
import Avatar from './Avatar'

export default function Layout() {
  const getIsDesktop = () =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches

  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const { data: groups } = useGroups()
  const [isDesktop, setIsDesktop] = useState(getIsDesktop)
  const [sidebarOpen, setSidebarOpen] = useState(getIsDesktop)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [showReconnected, setShowReconnected] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  // Close user menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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
          <NavLink to="/groups" className="text-xl font-bold text-indigo-400 hover:text-indigo-300 transition-colors">GEM</NavLink>
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
        {/* Collapsible Pages section */}
        <button
          onClick={() => setPagesOpen((v) => !v)}
          className="w-full flex items-center justify-between px-2 mb-1 text-xs uppercase tracking-wider text-gray-500 hover:text-gray-400 transition-colors"
        >
          <span>Pages</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`w-3 h-3 transition-transform ${pagesOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {pagesOpen && (
          <div className="mb-2 space-y-0.5">
            {[
              { to: '/', label: 'Home', end: true },
              { to: '/faq', label: 'FAQ', end: false },
              { to: '/contact', label: 'Contact', end: false },
            ].map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={closeSidebar}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
        )}

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
      <div className="p-3 border-t border-gray-800">
        {/* Developer panel link — admin only */}
        {user?.isAdmin && (
          <NavLink
            to="/developer"
            onClick={closeSidebar}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 mb-1 rounded-lg text-xs font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-indigo-400 hover:bg-gray-800'}`
            }
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            Developer
          </NavLink>
        )}
        {/* User menu */}
        <div
          ref={userMenuRef}
          className="relative"
          onMouseEnter={() => isDesktop && setUserMenuOpen(true)}
          onMouseLeave={() => isDesktop && setUserMenuOpen(false)}
        >
          <button
            onClick={() => setUserMenuOpen((prev) => !prev)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 transition-colors"
          >
            <Avatar
              name={user?.name ?? ''}
              avatarUrl={user?.avatarUrl}
              size="sm"
            />
            <span className="truncate flex-1 text-left">
              {user?.username ? `@${user.username}` : user?.name}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {userMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-800 border border-gray-700 rounded-lg py-1 shadow-xl z-50">
              <NavLink
                to="/profile"
                onClick={() => { setUserMenuOpen(false); closeSidebar() }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Profile
              </NavLink>
              <NavLink
                to="/settings"
                onClick={() => { setUserMenuOpen(false); closeSidebar() }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </NavLink>
              <div className="my-1 border-t border-gray-700" />
              <button
                onClick={() => { setUserMenuOpen(false); handleLogout() }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-gray-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
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
          <NavLink to="/groups" className="text-sm font-bold text-indigo-400 hover:text-indigo-300 transition-colors">GEM</NavLink>
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
